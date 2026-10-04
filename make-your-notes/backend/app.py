import base64
import html as html_lib
import json
import os
import re
import struct
import uuid
import zlib

import mysql.connector
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

from database import get_db_connection

load_dotenv()

app = Flask(__name__)
CORS(app, origins=["http://localhost:5173", "http://127.0.0.1:5173"])
MAX_PROFILE_IMAGE_SIZE = 5 * 1024 * 1024
MAX_NOTE_CONTENT_SIZE = 12 * 1024 * 1024
MAX_PAGE_DRAWING_SIZE = 2 * 1024 * 1024
app.config["MAX_CONTENT_LENGTH"] = MAX_NOTE_CONTENT_SIZE + 1024 * 1024
UPLOAD_FOLDER = os.path.join(app.root_path, "uploads")

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
URL_PATTERN = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)
PROFILE_FIELDS = ("name", "username", "bio", "college", "course", "skills", "github", "linkedin", "profile_picture")
NOTE_VISIBILITIES = {"private", "public"}
CODE_LANGUAGES = {"Java", "Python", "JavaScript", "Dart", "C", "C++"}
PROFILE_IMAGE_SIGNATURES = {
    ".jpg": lambda header: header.startswith(b"\xff\xd8\xff"),
    ".jpeg": lambda header: header.startswith(b"\xff\xd8\xff"),
    ".png": lambda header: header.startswith(b"\x89PNG\r\n\x1a\n"),
    ".webp": lambda header: header.startswith(b"RIFF") and header[8:12] == b"WEBP",
}


def delete_saved_upload(path):
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            app.logger.exception("Unable to remove an unused profile image")


@app.errorhandler(413)
def request_content_too_large(error):
    app.logger.warning("Rejected request: %s", error.description)
    return jsonify({"error": "The uploaded file or note content is too large."}), 413


@app.get("/uploads/<path:filename>")
def uploaded_profile_image(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


def record_activity(cursor, user_id, activity_type, description, related_type=None, related_id=None):
    cursor.execute(
        "INSERT INTO activities (user_id, activity_type, description, related_type, related_id) "
        "VALUES (%s, %s, %s, %s, %s)",
        (user_id, activity_type, description, related_type, related_id),
    )


def record_notification(cursor, recipient_id, actor_id, notification_type, related_type, related_id, message):
    if recipient_id and recipient_id != actor_id:
        cursor.execute("SELECT COALESCE(NULLIF(name, ''), username, 'A user') FROM users WHERE id=%s", (actor_id,))
        actor = cursor.fetchone()
        if actor:
            actor_name = actor[0] if not isinstance(actor, dict) else next(iter(actor.values()))
            message = message.replace(f"User {actor_id}", actor_name, 1)
        cursor.execute(
            "INSERT INTO notifications "
            "(recipient_user_id, actor_user_id, notification_type, related_type, related_id, message) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (recipient_id, actor_id, notification_type, related_type, related_id, message),
        )


def get_current_user_id():
    raw_user_id = request.headers.get("X-User-Id", "").strip()
    try:
        user_id = int(raw_user_id)
    except (TypeError, ValueError):
        return None
    return user_id if user_id > 0 else None


def note_from_row(note):
    return {
        "id": note["id"],
        "title": note["title"],
        "content": note["content"],
        "subject": note["subject"] or "",
        "tags": [tag.strip() for tag in (note["tags"] or "").split(",") if tag.strip()],
        "visibility": note["visibility"],
        "created_at": note["created_at"].isoformat() if note["created_at"] else None,
        "updated_at": note["updated_at"].isoformat() if note["updated_at"] else None,
    }


def is_valid_note_drawing(image_data):
    signature = b"\x89PNG\r\n\x1a\n"
    if not image_data.startswith(signature):
        return False
    offset = len(signature)
    saw_header = False
    saw_image_data = False
    while offset + 12 <= len(image_data):
        chunk_length = int.from_bytes(image_data[offset:offset + 4], "big")
        chunk_type = image_data[offset + 4:offset + 8]
        chunk_end = offset + 12 + chunk_length
        if chunk_end > len(image_data):
            return False
        chunk_data = image_data[offset + 8:offset + 8 + chunk_length]
        expected_crc = int.from_bytes(image_data[offset + 8 + chunk_length:chunk_end], "big")
        if zlib.crc32(chunk_type + chunk_data) & 0xFFFFFFFF != expected_crc:
            return False
        if not saw_header:
            if chunk_type != b"IHDR" or chunk_length != 13:
                return False
            width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(">IIBBBBB", chunk_data)
            if (width, height, bit_depth, color_type, compression, filter_method, interlace) != (1200, 540, 8, 6, 0, 0, 0):
                return False
            saw_header = True
        elif chunk_type == b"IHDR":
            return False
        if chunk_type == b"IDAT":
            saw_image_data = True
        offset = chunk_end
        if chunk_type == b"IEND":
            return chunk_length == 0 and saw_image_data and offset == len(image_data)
    return False


def parse_note_input(data):
    title = str(data.get("title", "")).strip()
    content = str(data.get("content", "")).strip()
    if len(content.encode("utf-8")) > MAX_NOTE_CONTENT_SIZE:
        return None, "Note content must be 12 MB or smaller."
    content_text = content
    try:
        stored_content = json.loads(content)
        if isinstance(stored_content, dict) and stored_content.get("format") == "makeYourNotes-rich-v1":
            if "pages" in stored_content and not isinstance(stored_content["pages"], list):
                return None, "Note pages must be provided as a list."
            if isinstance(stored_content.get("pages"), list):
                pages = stored_content["pages"]
                if not 1 <= len(pages) <= 50:
                    return None, "A note must have between 1 and 50 pages."
                page_text = []
                for page in pages:
                    if not isinstance(page, dict):
                        return None, "Each note page must have a heading and content."
                    heading = str(page.get("heading", "")).strip()
                    page_html = page.get("html")
                    if not heading or len(heading) > 200 or not isinstance(page_html, str):
                        return None, "Each note page must have a heading of 1 to 200 characters and content."
                    show_text = page.get("showText", True)
                    show_drawing = page.get("showDrawing", True)
                    if not isinstance(show_text, bool) or not isinstance(show_drawing, bool):
                        return None, "Page section visibility must be true or false."
                    drawing = page.get("drawing", "")
                    if drawing is None:
                        drawing = ""
                    if not isinstance(drawing, str):
                        return None, "Each page drawing must be a PNG image."
                    if drawing:
                        prefix = "data:image/png;base64,"
                        if not drawing.startswith(prefix) or len(drawing) > 3 * 1024 * 1024:
                            return None, "Each page drawing must be a PNG image no larger than 2 MB."
                        try:
                            image_data = base64.b64decode(drawing[len(prefix):], validate=True)
                        except (ValueError, base64.binascii.Error):
                            return None, "Each page drawing must be a valid PNG image."
                        if len(image_data) > MAX_PAGE_DRAWING_SIZE or not is_valid_note_drawing(image_data):
                            return None, "Each page drawing must be a valid PNG image no larger than 2 MB."
                    page_content = html_lib.unescape(re.sub(r"<[^>]*>", "", page_html))
                    visible_content = page_content if show_text else ""
                    if show_drawing and drawing:
                        visible_content += "\nDrawing"
                    page_text.append(visible_content)
                content_text = "\n".join(page_text)
            elif isinstance(stored_content.get("html"), str):
                content_text = html_lib.unescape(re.sub(r"<[^>]*>", "", stored_content["html"]))
    except json.JSONDecodeError:
        pass
    subject = str(data.get("subject", "")).strip()
    tags = data.get("tags", "")
    if isinstance(tags, list):
        tags = ", ".join(str(tag).strip() for tag in tags if str(tag).strip())
    else:
        tags = ", ".join(tag.strip() for tag in str(tags).split(",") if tag.strip())
    visibility = str(data.get("visibility", "private")).strip().lower()
    if not title or not content or not content_text.strip():
        return None, "Title and content are required."
    fields_are_too_long = (
        len(title) > 200
        or len(content_text) > 20000
        or len(subject) > 100
        or len(tags) > 500
        or (len(content) > 20000 and content_text == content)
    )
    if fields_are_too_long:
        return None, "One or more note fields are too long."
    if visibility not in NOTE_VISIBILITIES:
        return None, "Visibility must be private or public."
    return {"title": title, "content": content, "subject": subject, "tags": tags, "visibility": visibility}, None


def code_from_row(item):
    return {key: item[key] for key in ("id", "title", "description", "language", "code", "visibility")} | {
        "created_at": item["created_at"].isoformat() if item["created_at"] else None,
        "updated_at": item["updated_at"].isoformat() if item["updated_at"] else None,
    }


def parse_code_input(data):
    values = {key: str(data.get(key, "")).strip() for key in ("title", "description", "language", "code", "visibility")}
    if not values["title"] or not values["code"]:
        return None, "Title and code are required."
    if values["language"] not in CODE_LANGUAGES:
        return None, "Please select a supported language."
    if values["visibility"] not in NOTE_VISIBILITIES:
        return None, "Visibility must be private or public."
    if len(values["title"]) > 200 or len(values["description"]) > 1000 or len(values["code"]) > 100000:
        return None, "One or more code space fields are too long."
    return values, None


def profile_from_row(user):
    return {
        "id": user["id"],
        "name": user["name"],
        "username": user["username"] or user["name"].lower().replace(" ", "_"),
        "email": user["email"],
        "bio": user["bio"] or "",
        "college": user["college"] or "",
        "course": user["course"] or "",
        "skills": user["skills"] or "",
        "github": user["github"] or "",
        "linkedin": user["linkedin"] or "",
        "profile_picture": user["profile_picture"] or "",
    }


@app.get("/api/health")
def health():
    return jsonify({"message": "Backend is running"}), 200


@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not name or not email or not password:
        return jsonify({"error": "Name, email, and password are required."}), 400
    if not EMAIL_PATTERN.match(email):
        return jsonify({"error": "Please enter a valid email address."}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400

    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            "INSERT INTO users (name, email, password) VALUES (%s, %s, %s)",
            (name, email, generate_password_hash(password)),
        )
        connection.commit()
        return jsonify({"message": "Registration successful. You can now log in."}), 201
    except mysql.connector.IntegrityError:
        return jsonify({"error": "An account with that email already exists."}), 409
    except mysql.connector.Error:
        app.logger.exception("Database error while registering a user")
        return jsonify({"error": "The database is unavailable. Please try again later."}), 503
    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400
    if not EMAIL_PATTERN.match(email):
        return jsonify({"error": "Please enter a valid email address."}), 400

    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT id, name, email, password, profile_picture FROM users WHERE email = %s", (email,))
        user = cursor.fetchone()
        if not user or not check_password_hash(user["password"], password):
            return jsonify({"error": "Incorrect email or password."}), 401
        return jsonify(
            {
                "message": f"Welcome back, {user['name']}!",
                "user": {
                    "id": user["id"],
                    "name": user["name"],
                    "email": user["email"],
                    "profile_picture": user["profile_picture"] or "",
                },
            }
        ), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while logging in")
        return jsonify({"error": "The database is unavailable. Please try again later."}), 503
    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()


@app.get("/api/profile")
def get_profile():
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401

    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, name, username, email, bio, college, course, skills, github, linkedin, profile_picture "
            "FROM users WHERE id = %s",
            (user_id,),
        )
        user = cursor.fetchone()
        if not user:
            return jsonify({"error": "User not found."}), 404
        return jsonify({"profile": profile_from_row(user)}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading a profile")
        return jsonify({"error": "The profile is unavailable right now. Please try again later."}), 503
    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()


@app.put("/api/profile")
def update_profile():
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401

    data = request.form if request.mimetype == "multipart/form-data" else request.get_json(silent=True) or {}
    values = {field: str(data.get(field, "")).strip() for field in PROFILE_FIELDS}
    image = request.files.get("profile_picture_file")
    if not values["name"] or not values["username"]:
        return jsonify({"error": "Full name and username are required."}), 400
    if len(values["name"]) > 100 or len(values["username"]) > 50:
        return jsonify({"error": "Name or username is too long."}), 400
    if any(len(values[field]) > 500 for field in PROFILE_FIELDS if field not in ("name", "username")):
        return jsonify({"error": "Profile details are too long."}), 400
    for field in ("github", "linkedin"):
        if values[field] and not URL_PATTERN.match(values[field]):
            return jsonify({"error": f"Please enter a valid URL for {field.replace('_', ' ')}."}), 400
    if image:
        extension = os.path.splitext(image.filename or "")[1].lower()
        is_valid_image = PROFILE_IMAGE_SIGNATURES.get(extension)
        if not image.filename or not is_valid_image:
            return jsonify({"error": "Choose a JPEG, PNG, or WebP image."}), 400
        image_data = image.stream.read(MAX_PROFILE_IMAGE_SIZE + 1)
        image.stream.seek(0)
        if len(image_data) > MAX_PROFILE_IMAGE_SIZE:
            return jsonify({"error": "Profile images must be 5 MB or smaller."}), 400
        header = image_data[:12]
        if not is_valid_image(header):
            return jsonify({"error": "The uploaded file is not a valid JPEG, PNG, or WebP image."}), 400
        filename = f"{uuid.uuid4().hex}{extension}"
        values["profile_picture"] = f"{request.host_url.rstrip('/')}/uploads/{filename}"
    elif values["profile_picture"] and not URL_PATTERN.match(values["profile_picture"]):
        return jsonify({"error": "Please enter a valid URL for profile picture."}), 400

    connection = None
    cursor = None
    saved_image_path = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT id, email FROM users WHERE id = %s", (user_id,))
        existing_user = cursor.fetchone()
        if not existing_user:
            return jsonify({"error": "User not found."}), 404
        if image:
            try:
                os.makedirs(UPLOAD_FOLDER, exist_ok=True)
                saved_image_path = os.path.join(UPLOAD_FOLDER, filename)
                image.save(saved_image_path)
            except OSError:
                app.logger.exception("Unable to save an uploaded profile image")
                return jsonify({"error": "The profile image could not be saved."}), 500
        cursor.execute(
            "UPDATE users SET name = %s, username = %s, bio = %s, college = %s, course = %s, "
            "skills = %s, github = %s, linkedin = %s, profile_picture = %s WHERE id = %s",
            (*values.values(), user_id),
        )
        record_activity(cursor, user_id, "PROFILE_UPDATED", "You updated your profile.", "profile", user_id)
        connection.commit()
        return jsonify({"message": "Profile updated successfully.", "profile": {**values, "id": user_id, "email": existing_user["email"]}}), 200
    except mysql.connector.IntegrityError:
        delete_saved_upload(saved_image_path)
        return jsonify({"error": "That username is already in use."}), 409
    except mysql.connector.Error:
        delete_saved_upload(saved_image_path)
        app.logger.exception("Database error while updating a profile")
        return jsonify({"error": "The profile could not be saved. Please try again later."}), 503
    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()


@app.get("/api/notes")
def list_notes():
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401

    search = request.args.get("search", "").strip()
    subject = request.args.get("subject", "").strip()
    tag = request.args.get("tag", "").strip()
    visibility = request.args.get("visibility", "").strip().lower()
    sort = request.args.get("sort", "newest").strip().lower()
    sort_columns = {"newest": "created_at DESC", "oldest": "created_at ASC", "updated": "updated_at DESC", "alphabetical": "title ASC"}
    if visibility and visibility not in NOTE_VISIBILITIES:
        return jsonify({"error": "Invalid visibility filter."}), 400
    order_by = sort_columns.get(sort, sort_columns["newest"])

    conditions = ["user_id = %s"]
    params = [user_id]
    if search:
        conditions.append("(title LIKE %s OR content LIKE %s OR subject LIKE %s OR tags LIKE %s)")
        search_value = f"%{search}%"
        params.extend([search_value] * 4)
    if subject:
        conditions.append("subject = %s")
        params.append(subject)
    if tag:
        conditions.append("FIND_IN_SET(%s, REPLACE(tags, ', ', ',')) > 0")
        params.append(tag)
    if visibility:
        conditions.append("visibility = %s")
        params.append(visibility)

    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, title, content, subject, tags, visibility, created_at, updated_at "
            f"FROM notes WHERE {' AND '.join(conditions)} ORDER BY {order_by}",
            tuple(params),
        )
        return jsonify({"notes": [note_from_row(note) for note in cursor.fetchall()]}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while listing notes")
        return jsonify({"error": "Notes are unavailable right now. Please try again later."}), 503
    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()


@app.get("/api/notes/<int:note_id>")
def get_note(note_id):
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, title, content, subject, tags, visibility, created_at, updated_at "
            "FROM notes WHERE id=%s AND user_id=%s", (note_id, user_id)
        )
        note = cursor.fetchone()
        if not note:
            return jsonify({"error": "Note not found."}), 404
        return jsonify({"note": note_from_row(note)}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading a note")
        return jsonify({"error": "The note is unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/public/note/<int:note_id>")
@app.get("/api/public/notes/<int:note_id>")
def get_public_note(note_id):
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT n.id, n.title, n.content, n.subject, n.tags, n.visibility, "
            "n.created_at, n.updated_at, u.name AS author_name "
            "FROM notes n JOIN users u ON u.id=n.user_id "
            "WHERE n.id=%s AND n.visibility='public'",
            (note_id,),
        )
        note = cursor.fetchone()
        if not note:
            return jsonify({"success": False, "message": "This note is private or does not exist.", "error": "This note is private or does not exist."}), 404
        return jsonify({"note": {**note_from_row(note), "author_name": note["author_name"]}}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading a public note")
        return jsonify({"error": "The public note is unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/notes/options")
def note_options():
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401
    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT subject, tags FROM notes WHERE user_id = %s", (user_id,))
        subjects, tags = set(), set()
        for row in cursor.fetchall():
            if row["subject"]:
                subjects.add(row["subject"])
            tags.update(tag.strip() for tag in (row["tags"] or "").split(",") if tag.strip())
        return jsonify({"subjects": sorted(subjects), "tags": sorted(tags)}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading note options")
        return jsonify({"error": "Note filters are unavailable right now."}), 503
    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()


@app.post("/api/notes")
def create_note():
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401
    note, error = parse_note_input(request.get_json(silent=True) or {})
    if error:
        return jsonify({"error": error}), 400
    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            "INSERT INTO notes (user_id, title, content, subject, tags, visibility) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (user_id, note["title"], note["content"], note["subject"], note["tags"], note["visibility"]),
        )
        note_id = cursor.lastrowid
        record_activity(cursor, user_id, "NOTE_CREATED", f'You created a note: "{note["title"]}"', "note", note_id)
        connection.commit()
        return jsonify({"message": "Note created successfully.", "id": note_id}), 201
    except mysql.connector.Error:
        app.logger.exception("Database error while creating a note")
        return jsonify({"error": "The note could not be created."}), 503
    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()


@app.put("/api/notes/<int:note_id>")
def update_note(note_id):
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401
    note, error = parse_note_input(request.get_json(silent=True) or {})
    if error:
        return jsonify({"error": error}), 400
    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            "UPDATE notes SET title=%s, content=%s, subject=%s, tags=%s, visibility=%s "
            "WHERE id=%s AND user_id=%s",
            (note["title"], note["content"], note["subject"], note["tags"], note["visibility"], note_id, user_id),
        )
        cursor.execute("SELECT id FROM notes WHERE id=%s AND user_id=%s", (note_id, user_id))
        if not cursor.fetchone():
            return jsonify({"error": "Note not found."}), 404
        record_activity(cursor, user_id, "NOTE_UPDATED", f'You updated a note: "{note["title"]}"', "note", note_id)
        connection.commit()
        return jsonify({"message": "Note updated successfully."}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while updating a note")
        return jsonify({"error": "The note could not be updated."}), 503
    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()


@app.delete("/api/notes/<int:note_id>")
def delete_note(note_id):
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401
    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("DELETE FROM notes WHERE id=%s AND user_id=%s", (note_id, user_id))
        if cursor.rowcount == 0:
            return jsonify({"error": "Note not found."}), 404
        connection.commit()
        return jsonify({"message": "Note deleted successfully."}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while deleting a note")
        return jsonify({"error": "The note could not be deleted."}), 503
    finally:
        if cursor:
            cursor.close()
        if connection and connection.is_connected():
            connection.close()


@app.post("/api/code")
def create_code_space():
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401
    values, error = parse_code_input(request.get_json(silent=True) or {})
    if error:
        return jsonify({"error": error}), 400
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            "INSERT INTO code_spaces (user_id, title, description, language, code, visibility) VALUES (%s,%s,%s,%s,%s,%s)",
            (user_id, values["title"], values["description"], values["language"], values["code"], values["visibility"]),
        )
        code_id = cursor.lastrowid
        record_activity(cursor, user_id, "CODE_CREATED", f'You created a Code Space: "{values["title"]}"', "code", code_id)
        connection.commit()
        return jsonify({"message": "Code space created successfully.", "id": code_id}), 201
    except mysql.connector.Error:
        app.logger.exception("Database error while creating a code space")
        return jsonify({"error": "The code space could not be created."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/code")
def list_code_spaces():
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, title, description, language, code, visibility, created_at, updated_at "
            "FROM code_spaces WHERE user_id=%s ORDER BY updated_at DESC",
            (user_id,),
        )
        return jsonify({"code_spaces": [code_from_row(item) for item in cursor.fetchall()]}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while listing code spaces")
        return jsonify({"error": "Code spaces are unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/code/<int:code_id>")
def get_code_space(code_id):
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, title, description, language, code, visibility, created_at, updated_at "
            "FROM code_spaces WHERE id=%s AND user_id=%s", (code_id, user_id)
        )
        item = cursor.fetchone()
        if not item: return jsonify({"error": "Code space not found."}), 404
        return jsonify({"code_space": code_from_row(item)}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading a code space")
        return jsonify({"error": "The code space is unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/public/code/<int:code_id>")
def get_public_code_space(code_id):
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT c.id, c.title, c.description, c.language, c.code, c.visibility, "
            "c.created_at, c.updated_at, u.name AS author_name "
            "FROM code_spaces c JOIN users u ON u.id=c.user_id "
            "WHERE c.id=%s AND c.visibility='public'",
            (code_id,),
        )
        item = cursor.fetchone()
        if not item:
            return jsonify({"success": False, "message": "This code space is private or does not exist.", "error": "This code space is private or does not exist."}), 404
        return jsonify({"code_space": {**code_from_row(item), "author_name": item["author_name"]}}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading a public code space")
        return jsonify({"error": "The public code space is unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/explore")
def explore():
    query = request.args.get("q", "").strip()
    subject = request.args.get("subject", "").strip()
    tag = request.args.get("tag", "").strip()
    language = request.args.get("language", "").strip()
    sort = request.args.get("sort", "newest").strip().lower()
    try:
        page = max(1, int(request.args.get("page", 1)))
        limit = min(20, max(1, int(request.args.get("limit", 20))))
    except ValueError:
        return jsonify({"error": "Invalid pagination values."}), 400
    sort_columns = {
        "newest": "created_at DESC",
        "updated": "updated_at DESC",
        "oldest": "created_at ASC",
        "alphabetical": "title ASC",
    }
    order = sort_columns.get(sort)
    if not order:
        return jsonify({"error": "Invalid sort option."}), 400
    offset = (page - 1) * limit
    like = f"%{query}%"
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            f"SELECT n.id, n.title, n.content, n.subject, n.tags, n.visibility, "
            f"n.created_at, n.updated_at, u.username, u.name AS author_name, u.profile_picture "
            "FROM notes n JOIN users u ON u.id=n.user_id "
            "WHERE n.visibility='public' AND (%s='' OR n.title LIKE %s OR n.subject LIKE %s OR n.tags LIKE %s) "
            "AND (%s='' OR n.subject=%s) AND (%s='' OR FIND_IN_SET(%s, REPLACE(n.tags, ', ', ',')) > 0) "
            f"ORDER BY n.{order.split()[0]} {order.split()[1]} LIMIT %s OFFSET %s",
            (query, like, like, like, subject, subject, tag, tag, limit + 1, offset),
        )
        note_rows = cursor.fetchall()
        notes = [{**note_from_row(row), "username": row["username"], "author_name": row["author_name"], "profile_picture": row["profile_picture"]} for row in note_rows[:limit]]
        cursor.execute(
            f"SELECT c.id, c.title, c.description, c.language, c.code, c.visibility, c.created_at, c.updated_at, "
            "u.username, u.name AS author_name FROM code_spaces c JOIN users u ON u.id=c.user_id "
            "WHERE c.visibility='public' AND (%s='' OR c.title LIKE %s OR c.description LIKE %s OR c.language LIKE %s) "
            "AND (%s='' OR c.language=%s) "
            f"ORDER BY c.{order.split()[0]} {order.split()[1]} LIMIT %s OFFSET %s",
            (query, like, like, like, language, language, limit + 1, offset),
        )
        code_rows = cursor.fetchall()
        code_spaces = [{**code_from_row(row), "username": row["username"], "author_name": row["author_name"]} for row in code_rows[:limit]]
        cursor.execute(
            "SELECT id, username, name, bio, college, course, skills, profile_picture, "
            "(SELECT COUNT(*) FROM follows f WHERE f.following_id=users.id) AS followers_count "
            "FROM users WHERE username IS NOT NULL AND (%s='' OR username LIKE %s OR name LIKE %s) "
            "ORDER BY created_at DESC LIMIT %s OFFSET %s",
            (query, like, like, limit + 1, offset),
        )
        user_rows = cursor.fetchall()
        users = [dict(row) for row in user_rows[:limit]]
        current_user_id = get_current_user_id()
        if current_user_id and users:
            ids = [row["id"] for row in users]
            placeholders = ", ".join(["%s"] * len(ids))
            cursor.execute(
                f"SELECT following_id FROM follows WHERE follower_id=%s AND following_id IN ({placeholders})",
                [current_user_id, *ids],
            )
            following = {row["following_id"] for row in cursor.fetchall()}
            for user in users:
                user["is_following"] = user["id"] in following
        else:
            for user in users:
                user["is_following"] = False
        cursor.execute(
            "SELECT subject, COUNT(*) AS note_count FROM notes "
            "WHERE visibility='public' AND subject IS NOT NULL AND subject <> '' "
            "GROUP BY subject ORDER BY subject ASC"
        )
        subjects = [{"name": row["subject"], "count": row["note_count"]} for row in cursor.fetchall()]
        cursor.execute("SELECT DISTINCT language FROM code_spaces WHERE visibility='public' ORDER BY language ASC")
        languages = [row["language"] for row in cursor.fetchall()]
        cursor.execute("SELECT tags FROM notes WHERE visibility='public' AND tags IS NOT NULL")
        tags = sorted({tag.strip() for row in cursor.fetchall() for tag in row["tags"].split(",") if tag.strip()})
        return jsonify({
            "notes": notes, "code_spaces": code_spaces, "users": users, "subjects": subjects, "languages": languages, "tags": tags,
            "pagination": {
                "page": page, "limit": limit,
                "notes_has_more": len(note_rows) > limit,
                "code_spaces_has_more": len(code_rows) > limit,
                "users_has_more": len(user_rows) > limit,
            },
        }), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while exploring public content")
        return jsonify({"error": "Explore is unavailable right now. Please try again later."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/public/users/<username>")
def public_user(username):
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, username, name, bio, college, course, skills, profile_picture "
            "FROM users WHERE username=%s", (username,)
        )
        user = cursor.fetchone()
        if not user:
            return jsonify({"error": "User not found."}), 404
        cursor.execute(
            "SELECT id, title, content, subject, tags, visibility, created_at, updated_at "
            "FROM notes WHERE user_id=%s AND visibility='public' ORDER BY updated_at DESC LIMIT 20",
            (user["id"],),
        )
        notes = [note_from_row(row) for row in cursor.fetchall()]
        for note in notes:
            cursor.execute(
                "SELECT (SELECT COUNT(*) FROM note_likes WHERE note_id=%s) AS likes, "
                "(SELECT COUNT(*) FROM note_bookmarks WHERE note_id=%s) AS bookmarks, "
                "(SELECT COUNT(*) FROM note_comments WHERE note_id=%s) AS comments",
                (note["id"], note["id"], note["id"]),
            )
            note.update(cursor.fetchone())
        cursor.execute(
            "SELECT id, title, description, language, code, visibility, created_at, updated_at "
            "FROM code_spaces WHERE user_id=%s AND visibility='public' ORDER BY updated_at DESC LIMIT 20",
            (user["id"],),
        )
        code_spaces = [code_from_row(row) for row in cursor.fetchall()]
        for code_space in code_spaces:
            cursor.execute(
                "SELECT (SELECT COUNT(*) FROM code_likes WHERE code_space_id=%s) AS likes, "
                "(SELECT COUNT(*) FROM code_bookmarks WHERE code_space_id=%s) AS bookmarks, "
                "(SELECT COUNT(*) FROM code_comments WHERE code_space_id=%s) AS comments",
                (code_space["id"], code_space["id"], code_space["id"]),
            )
            code_space.update(cursor.fetchone())
        user_id = user["id"]
        current_user_id = get_current_user_id()
        cursor.execute("SELECT COUNT(*) AS count FROM follows WHERE following_id=%s", (user_id,))
        followers_count = cursor.fetchone()["count"]
        cursor.execute("SELECT COUNT(*) AS count FROM follows WHERE follower_id=%s", (user_id,))
        following_count = cursor.fetchone()["count"]
        cursor.execute("SELECT COUNT(*) AS count FROM notes WHERE user_id=%s AND visibility='public'", (user_id,))
        public_notes_count = cursor.fetchone()["count"]
        cursor.execute("SELECT COUNT(*) AS count FROM code_spaces WHERE user_id=%s AND visibility='public'", (user_id,))
        public_code_count = cursor.fetchone()["count"]
        cursor.execute(
            "SELECT (SELECT COUNT(*) FROM note_likes l JOIN notes n ON n.id=l.note_id WHERE n.user_id=%s) + "
            "(SELECT COUNT(*) FROM code_likes l JOIN code_spaces c ON c.id=l.code_space_id WHERE c.user_id=%s) AS likes_received",
            (user_id, user_id),
        )
        likes_received = cursor.fetchone()["likes_received"]
        is_following = False
        if current_user_id:
            cursor.execute(
                "SELECT 1 FROM follows WHERE follower_id=%s AND following_id=%s",
                (current_user_id, user_id),
            )
            is_following = cursor.fetchone() is not None
        user.update({"followers_count": followers_count, "following_count": following_count, "public_notes_count": public_notes_count, "public_code_count": public_code_count, "likes_received": likes_received, "is_following": is_following})
        return jsonify({"user": user, "notes": notes, "code_spaces": code_spaces}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading a public user")
        return jsonify({"error": "The public profile is unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


def follow_user_list(user_id, direction):
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        column = "following_id" if direction == "followers" else "follower_id"
        cursor.execute(
            f"SELECT u.id, u.username, u.name, u.bio, u.skills, u.profile_picture, "
            f"(SELECT COUNT(*) FROM follows f2 WHERE f2.following_id=u.id) AS followers_count "
            f"FROM follows f JOIN users u ON u.id=f.{column} "
            "WHERE f." + ("following_id" if direction == "followers" else "follower_id") + "=%s "
            "ORDER BY f.created_at DESC",
            (user_id,),
        )
        users = cursor.fetchall()
        current_user_id = get_current_user_id()
        if current_user_id and users:
            ids = [row["id"] for row in users]
            placeholders = ", ".join(["%s"] * len(ids))
            cursor.execute(
                f"SELECT following_id FROM follows WHERE follower_id=%s AND following_id IN ({placeholders})",
                [current_user_id, *ids],
            )
            following = {row["following_id"] for row in cursor.fetchall()}
            for row in users:
                row["is_following"] = row["id"] in following
        else:
            for row in users:
                row["is_following"] = False
        return jsonify({"users": users}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading follow list")
        return jsonify({"error": "The follow list is unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.post("/api/users/<int:target_user_id>/follow")
def follow_user(target_user_id):
    follower_id = get_current_user_id()
    if follower_id is None:
        return jsonify({"error": "Authentication is required."}), 401
    if follower_id == target_user_id:
        return jsonify({"error": "You cannot follow yourself."}), 400
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT id, name, username FROM users WHERE id=%s", (target_user_id,))
        target = cursor.fetchone()
        if not target:
            return jsonify({"error": "User not found."}), 404
        cursor.execute(
            "SELECT id FROM follows WHERE follower_id=%s AND following_id=%s",
            (follower_id, target_user_id),
        )
        if cursor.fetchone():
            return jsonify({"error": "You are already following this user."}), 409
        cursor.execute(
            "INSERT INTO follows (follower_id, following_id) VALUES (%s, %s)",
            (follower_id, target_user_id),
        )
        cursor.execute("SELECT COALESCE(NULLIF(name, ''), username, 'Someone') AS actor_name FROM users WHERE id=%s", (follower_id,))
        actor_name = cursor.fetchone()["actor_name"]
        record_activity(cursor, follower_id, "USER_FOLLOWED", f"{actor_name} started following {target['name'] or target['username']}.", "user", target_user_id)
        record_notification(cursor, target_user_id, follower_id, "USER_FOLLOWED", "user", follower_id, f"{actor_name} started following you")
        connection.commit()
        return jsonify({"message": "User followed successfully"}), 201
    except mysql.connector.Error:
        if connection:
            connection.rollback()
        app.logger.exception("Database error while following user")
        return jsonify({"error": "The user could not be followed."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.delete("/api/users/<int:target_user_id>/follow")
def unfollow_user(target_user_id):
    follower_id = get_current_user_id()
    if follower_id is None:
        return jsonify({"error": "Authentication is required."}), 401
    if follower_id == target_user_id:
        return jsonify({"error": "You cannot unfollow yourself."}), 400
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            "DELETE FROM follows WHERE follower_id=%s AND following_id=%s",
            (follower_id, target_user_id),
        )
        if cursor.rowcount == 0:
            return jsonify({"error": "Follow relationship not found."}), 404
        connection.commit()
        return jsonify({"message": "User unfollowed successfully"}), 200
    except mysql.connector.Error:
        if connection:
            connection.rollback()
        app.logger.exception("Database error while unfollowing user")
        return jsonify({"error": "The user could not be unfollowed."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/users/<int:target_user_id>/followers")
def get_followers(target_user_id):
    return follow_user_list(target_user_id, "followers")


@app.get("/api/users/<int:target_user_id>/following")
def get_following(target_user_id):
    return follow_user_list(target_user_id, "following")


@app.get("/api/users/<int:target_user_id>/follow-status")
def follow_status(target_user_id):
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT id FROM users WHERE id=%s", (target_user_id,))
        if not cursor.fetchone():
            return jsonify({"error": "User not found."}), 404
        current_user_id = get_current_user_id()
        is_following = False
        if current_user_id:
            cursor.execute("SELECT 1 FROM follows WHERE follower_id=%s AND following_id=%s", (current_user_id, target_user_id))
            is_following = cursor.fetchone() is not None
        cursor.execute("SELECT COUNT(*) AS count FROM follows WHERE following_id=%s", (target_user_id,))
        followers_count = cursor.fetchone()["count"]
        cursor.execute("SELECT COUNT(*) AS count FROM follows WHERE follower_id=%s", (target_user_id,))
        following_count = cursor.fetchone()["count"]
        return jsonify({"is_following": is_following, "followers_count": followers_count, "following_count": following_count}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading follow status")
        return jsonify({"error": "Follow status is unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


def public_note_exists(cursor, note_id):
    cursor.execute("SELECT id FROM notes WHERE id=%s AND visibility='public'", (note_id,))
    return cursor.fetchone() is not None


@app.get("/api/public/notes/<int:note_id>/community")
def note_community(note_id):
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        if not public_note_exists(cursor, note_id):
            return jsonify({"error": "This note is private or does not exist."}), 404
        cursor.execute("SELECT COUNT(*) AS count FROM note_likes WHERE note_id=%s", (note_id,))
        likes = cursor.fetchone()["count"]
        viewer_id = get_current_user_id()
        liked = bookmarked = False
        if viewer_id:
            cursor.execute("SELECT 1 FROM note_likes WHERE note_id=%s AND user_id=%s", (note_id, viewer_id))
            liked = cursor.fetchone() is not None
            cursor.execute("SELECT 1 FROM note_bookmarks WHERE note_id=%s AND user_id=%s", (note_id, viewer_id))
            bookmarked = cursor.fetchone() is not None
        cursor.execute(
            "SELECT c.id, c.content, c.created_at, c.user_id, u.name, u.username, u.profile_picture "
            "FROM note_comments c JOIN users u ON u.id=c.user_id "
            "WHERE c.note_id=%s ORDER BY c.created_at ASC", (note_id,)
        )
        comments = [{**row, "created_at": row["created_at"].isoformat()} for row in cursor.fetchall()]
        return jsonify({"likes": likes, "liked": liked, "bookmarked": bookmarked, "comments": comments}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading note community data")
        return jsonify({"error": "Community data is unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/public/code/<int:code_id>/community")
def code_community(code_id):
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT id FROM code_spaces WHERE id=%s AND visibility='public'", (code_id,))
        if not cursor.fetchone():
            return jsonify({"error": "This code space is private or does not exist."}), 404
        cursor.execute("SELECT COUNT(*) AS count FROM code_likes WHERE code_space_id=%s", (code_id,))
        likes = cursor.fetchone()["count"]
        viewer_id = get_current_user_id()
        liked = bookmarked = False
        if viewer_id:
            cursor.execute("SELECT 1 FROM code_likes WHERE code_space_id=%s AND user_id=%s", (code_id, viewer_id))
            liked = cursor.fetchone() is not None
            cursor.execute("SELECT 1 FROM code_bookmarks WHERE code_space_id=%s AND user_id=%s", (code_id, viewer_id))
            bookmarked = cursor.fetchone() is not None
        cursor.execute(
            "SELECT c.id, c.content, c.created_at, c.user_id, u.name, u.username, u.profile_picture "
            "FROM code_comments c JOIN users u ON u.id=c.user_id "
            "WHERE c.code_space_id=%s ORDER BY c.created_at ASC", (code_id,)
        )
        comments = [{**row, "created_at": row["created_at"].isoformat()} for row in cursor.fetchall()]
        return jsonify({"likes": likes, "liked": liked, "bookmarked": bookmarked, "comments": comments}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading code community data")
        return jsonify({"error": "Community data is unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


def update_code_interaction(code_id, table, column, user_id, add):
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT user_id, title FROM code_spaces WHERE id=%s AND visibility='public'", (code_id,))
        code_space = cursor.fetchone()
        if not code_space:
            return jsonify({"error": "Only public Code Spaces support this feature."}), 404
        if add:
            cursor.execute(f"INSERT IGNORE INTO {table} (code_space_id, user_id) VALUES (%s, %s)", (code_id, user_id))
            if cursor.rowcount:
                activity_type = "CODE_LIKED" if column == "liked" else "CODE_BOOKMARKED"
                record_activity(cursor, user_id, f"{activity_type}", f"You {'liked' if column == 'liked' else 'bookmarked'} a Code Space.", "code", code_id)
                notification_type = "CODE_LIKED" if column == "liked" else "CODE_BOOKMARKED"
                action = "liked" if column == "liked" else "bookmarked"
                record_notification(cursor, code_space["user_id"], user_id, notification_type, "code", code_id, f'User {user_id} {action} your code space "{code_space["title"]}"')
        else:
            cursor.execute(f"DELETE FROM {table} WHERE code_space_id=%s AND user_id=%s", (code_id, user_id))
        connection.commit()
        return jsonify({column: add}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while updating Code Space interaction")
        return jsonify({"error": "Unable to update this Code Space right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.post("/api/code/<int:code_id>/like")
def like_code(code_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    return update_code_interaction(code_id, "code_likes", "liked", user_id, True)


@app.delete("/api/code/<int:code_id>/like")
def unlike_code(code_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    return update_code_interaction(code_id, "code_likes", "liked", user_id, False)


@app.post("/api/code/<int:code_id>/bookmark")
def bookmark_code(code_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    return update_code_interaction(code_id, "code_bookmarks", "bookmarked", user_id, True)


@app.delete("/api/code/<int:code_id>/bookmark")
def unbookmark_code(code_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    return update_code_interaction(code_id, "code_bookmarks", "bookmarked", user_id, False)


@app.get("/api/bookmarks")
def list_bookmarks():
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT n.id, n.title, n.content, n.subject, n.tags, n.visibility, "
            "n.created_at, n.updated_at, u.name AS author_name "
            "FROM note_bookmarks b JOIN notes n ON n.id=b.note_id JOIN users u ON u.id=n.user_id "
            "WHERE b.user_id=%s AND n.visibility='public' ORDER BY b.created_at DESC", (user_id,)
        )
        notes = [{**note_from_row(row), "author_name": row["author_name"]} for row in cursor.fetchall()]
        cursor.execute(
            "SELECT c.id, c.title, c.description, c.language, c.updated_at, u.name AS author_name "
            "FROM code_bookmarks b JOIN code_spaces c ON c.id=b.code_space_id JOIN users u ON u.id=c.user_id "
            "WHERE b.user_id=%s AND c.visibility='public' ORDER BY b.created_at DESC", (user_id,)
        )
        code_spaces = [dict(row) for row in cursor.fetchall()]
        return jsonify({"notes": notes, "code_spaces": code_spaces}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading bookmarks")
        return jsonify({"error": "Bookmarks are unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.post("/api/notes/<int:note_id>/like")
def like_note(note_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT user_id, title FROM notes WHERE id=%s AND visibility='public'", (note_id,))
        note = cursor.fetchone()
        if not note:
            return jsonify({"error": "Only public notes can be liked."}), 404
        cursor.execute("INSERT IGNORE INTO note_likes (note_id, user_id) VALUES (%s, %s)", (note_id, user_id))
        if cursor.rowcount:
            record_activity(cursor, user_id, "NOTE_LIKED", f"You liked a note.", "note", note_id)
            record_notification(cursor, note["user_id"], user_id, "NOTE_LIKED", "note", note_id, f'User {user_id} liked your note "{note["title"]}"')
        connection.commit()
        return jsonify({"liked": True}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while liking a note")
        return jsonify({"error": "The like could not be saved."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.delete("/api/notes/<int:note_id>/like")
def unlike_note(note_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        if not public_note_exists(cursor, note_id):
            return jsonify({"error": "Only public notes support this feature."}), 404
        cursor.execute("DELETE FROM note_likes WHERE note_id=%s AND user_id=%s", (note_id, user_id))
        connection.commit()
        return jsonify({"liked": False}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while removing a note like")
        return jsonify({"error": "The like could not be removed."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.post("/api/notes/<int:note_id>/bookmark")
def bookmark_note(note_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT user_id, title FROM notes WHERE id=%s AND visibility='public'", (note_id,))
        note = cursor.fetchone()
        if not note:
            return jsonify({"error": "Only public notes can be bookmarked."}), 404
        cursor.execute("INSERT IGNORE INTO note_bookmarks (note_id, user_id) VALUES (%s, %s)", (note_id, user_id))
        if cursor.rowcount:
            record_activity(cursor, user_id, "NOTE_BOOKMARKED", f"You bookmarked a note.", "note", note_id)
            record_notification(cursor, note["user_id"], user_id, "NOTE_BOOKMARKED", "note", note_id, f'User {user_id} bookmarked your note "{note["title"]}"')
        connection.commit()
        return jsonify({"bookmarked": True}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while bookmarking a note")
        return jsonify({"error": "The bookmark could not be saved."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.delete("/api/notes/<int:note_id>/bookmark")
def unbookmark_note(note_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        if not public_note_exists(cursor, note_id):
            return jsonify({"error": "Only public notes support this feature."}), 404
        cursor.execute("DELETE FROM note_bookmarks WHERE note_id=%s AND user_id=%s", (note_id, user_id))
        connection.commit()
        return jsonify({"bookmarked": False}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while removing a note bookmark")
        return jsonify({"error": "The bookmark could not be removed."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.post("/api/notes/<int:note_id>/comments")
def create_comment(note_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    content = str((request.get_json(silent=True) or {}).get("content", "")).strip()
    if not content or len(content) > 2000: return jsonify({"error": "Comment must be between 1 and 2000 characters."}), 400
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT user_id, title FROM notes WHERE id=%s AND visibility='public'", (note_id,))
        note = cursor.fetchone()
        if not note: return jsonify({"error": "Only public notes can be commented on."}), 404
        cursor.execute("INSERT INTO note_comments (note_id, user_id, content) VALUES (%s,%s,%s)", (note_id, user_id, content))
        comment_id = cursor.lastrowid
        record_activity(cursor, user_id, "COMMENT_CREATED", "You commented on a note.", "note", note_id)
        record_notification(cursor, note[0], user_id, "COMMENT_CREATED", "note", note_id, f'User {user_id} commented on your note "{note[1]}"')
        connection.commit()
        return jsonify({"message": "Comment added.", "id": comment_id}), 201
    except mysql.connector.Error:
        app.logger.exception("Database error while creating a comment")
        return jsonify({"error": "The comment could not be saved."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.delete("/api/comments/<int:comment_id>")
def delete_comment(comment_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("DELETE FROM note_comments WHERE id=%s AND user_id=%s", (comment_id, user_id))
        deleted = cursor.rowcount
        if not deleted:
            cursor.execute("DELETE FROM code_comments WHERE id=%s AND user_id=%s", (comment_id, user_id))
            deleted = cursor.rowcount
        if not deleted: return jsonify({"error": "Comment not found or not owned by you."}), 404
        connection.commit()
        return jsonify({"message": "Comment deleted."}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while deleting a comment")
        return jsonify({"error": "The comment could not be deleted."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.post("/api/code/<int:code_id>/comments")
def create_code_comment(code_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    content = str((request.get_json(silent=True) or {}).get("content", "")).strip()
    if not content or len(content) > 2000:
        return jsonify({"error": "Comment must be between 1 and 2000 characters."}), 400
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT user_id, title FROM code_spaces WHERE id=%s AND visibility='public'", (code_id,))
        code_space = cursor.fetchone()
        if not code_space: return jsonify({"error": "Only public Code Spaces can be commented on."}), 404
        cursor.execute("INSERT INTO code_comments (code_space_id, user_id, content) VALUES (%s,%s,%s)", (code_id, user_id, content))
        comment_id = cursor.lastrowid
        record_activity(cursor, user_id, "COMMENT_CREATED", "You commented on a Code Space.", "code", code_id)
        record_notification(cursor, code_space[0], user_id, "COMMENT_CREATED", "code", code_id, f'User {user_id} commented on your code space "{code_space[1]}"')
        connection.commit()
        return jsonify({"message": "Comment added.", "id": comment_id}), 201
    except mysql.connector.Error:
        app.logger.exception("Database error while creating a Code Space comment")
        return jsonify({"error": "The comment could not be saved."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/notes/<int:note_id>/comments")
def get_note_comments(note_id):
    return get_public_comments("note", note_id)


@app.get("/api/code/<int:code_id>/comments")
def get_code_comments(code_id):
    return get_public_comments("code", code_id)


def get_public_comments(item_type, item_id):
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        if item_type == "note":
            cursor.execute("SELECT id FROM notes WHERE id=%s AND visibility='public'", (item_id,))
            table_clause = "FROM note_comments c JOIN users u ON u.id=c.user_id WHERE c.note_id=%s"
        else:
            cursor.execute("SELECT id FROM code_spaces WHERE id=%s AND visibility='public'", (item_id,))
            table_clause = "FROM code_comments c JOIN users u ON u.id=c.user_id WHERE c.code_space_id=%s"
        if not cursor.fetchone(): return jsonify({"error": "Comments are unavailable for private content."}), 404
        cursor.execute(f"SELECT c.id, c.content, c.created_at, c.user_id, u.name, u.username, u.profile_picture {table_clause} ORDER BY c.created_at ASC", (item_id,))
        return jsonify({"comments": [{**row, "created_at": row["created_at"].isoformat()} for row in cursor.fetchall()]}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading comments")
        return jsonify({"error": "Comments are unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/stats")
def user_stats():
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT (SELECT COUNT(*) FROM notes WHERE user_id=%s) AS notes_created, "
            "(SELECT COUNT(*) FROM code_spaces WHERE user_id=%s) AS code_spaces_created, "
            "(SELECT COUNT(*) FROM notes WHERE user_id=%s AND visibility='public') AS public_notes, "
            "(SELECT COUNT(*) FROM code_spaces WHERE user_id=%s AND visibility='public') AS public_code_spaces, "
            "(SELECT COUNT(*) FROM follows WHERE following_id=%s) AS followers, "
            "(SELECT COUNT(*) FROM follows WHERE follower_id=%s) AS following, "
            "(SELECT COUNT(*) FROM note_likes l JOIN notes n ON n.id=l.note_id WHERE n.user_id=%s) + "
            "(SELECT COUNT(*) FROM code_likes l JOIN code_spaces c ON c.id=l.code_space_id WHERE c.user_id=%s) AS likes_received, "
            "(SELECT COUNT(*) FROM note_bookmarks WHERE user_id=%s) + "
            "(SELECT COUNT(*) FROM code_bookmarks WHERE user_id=%s) AS bookmarks",
            (user_id,) * 10,
        )
        return jsonify({"stats": cursor.fetchone()}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading user stats")
        return jsonify({"error": "Statistics are unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/dashboard")
def dashboard():
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT (SELECT COUNT(*) FROM notes WHERE user_id=%s) AS notes, "
            "(SELECT COUNT(*) FROM code_spaces WHERE user_id=%s) AS code_spaces, "
            "(SELECT COUNT(*) FROM follows WHERE following_id=%s) AS followers, "
            "(SELECT COUNT(*) FROM follows WHERE follower_id=%s) AS following, "
            "(SELECT COUNT(*) FROM note_likes l JOIN notes n ON n.id=l.note_id WHERE n.user_id=%s) + "
            "(SELECT COUNT(*) FROM code_likes l JOIN code_spaces c ON c.id=l.code_space_id WHERE c.user_id=%s) AS likes_received, "
            "(SELECT COUNT(*) FROM note_bookmarks WHERE user_id=%s) + "
            "(SELECT COUNT(*) FROM code_bookmarks WHERE user_id=%s) AS bookmarks",
            (user_id,) * 8,
        )
        stats = cursor.fetchone()
        cursor.execute(
            "SELECT id, title, content, subject, tags, visibility, created_at, updated_at "
            "FROM notes WHERE user_id=%s ORDER BY updated_at DESC LIMIT 5", (user_id,)
        )
        recent_notes = [note_from_row(row) for row in cursor.fetchall()]
        cursor.execute(
            "SELECT id, title, description, language, code, visibility, created_at, updated_at "
            "FROM code_spaces WHERE user_id=%s ORDER BY updated_at DESC LIMIT 5", (user_id,)
        )
        recent_code_spaces = [code_from_row(row) for row in cursor.fetchall()]
        cursor.execute(
            "SELECT id, activity_type, description, related_type, related_id, created_at "
            "FROM activities WHERE user_id=%s ORDER BY created_at DESC LIMIT 20", (user_id,)
        )
        recent_activity = [{**row, "created_at": row["created_at"].isoformat()} for row in cursor.fetchall()]
        return jsonify({"stats": stats, "recent_notes": recent_notes, "recent_code_spaces": recent_code_spaces, "recent_activity": recent_activity}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading dashboard")
        return jsonify({"error": "Dashboard data is unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/activity")
def activity():
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, activity_type, description, related_type, related_id, created_at "
            "FROM activities WHERE user_id=%s ORDER BY created_at DESC LIMIT 20", (user_id,)
        )
        return jsonify({"activity": [{**row, "created_at": row["created_at"].isoformat()} for row in cursor.fetchall()]}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading activity")
        return jsonify({"error": "Activity is unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/notifications")
def notifications():
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    try:
        limit = min(50, max(1, int(request.args.get("limit", 20))))
    except ValueError:
        return jsonify({"error": "Invalid limit."}), 400
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT n.id, n.notification_type, n.related_type, n.related_id, n.message, "
            "n.is_read, n.created_at, u.name AS actor_name, u.username AS actor_username "
            "FROM notifications n LEFT JOIN users u ON u.id=n.actor_user_id "
            "WHERE n.recipient_user_id=%s ORDER BY n.created_at DESC LIMIT %s", (user_id, limit)
        )
        return jsonify({"notifications": [{**row, "created_at": row["created_at"].isoformat()} for row in cursor.fetchall()]}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while loading notifications")
        return jsonify({"error": "Notifications are unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.get("/api/notifications/unread-count")
def unread_notification_count():
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT COUNT(*) AS count FROM notifications WHERE recipient_user_id=%s AND is_read=FALSE", (user_id,))
        return jsonify({"count": cursor.fetchone()["count"]}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while counting notifications")
        return jsonify({"error": "Notification count is unavailable right now."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.put("/api/notifications/<int:notification_id>/read")
def mark_notification_read(notification_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    return update_notification_read(notification_id, user_id, False)


@app.put("/api/notifications/read-all")
def mark_all_notifications_read():
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("UPDATE notifications SET is_read=TRUE WHERE recipient_user_id=%s AND is_read=FALSE", (user_id,))
        connection.commit()
        return jsonify({"message": "All notifications marked as read."}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while marking notifications read")
        return jsonify({"error": "Notifications could not be updated."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


def update_notification_read(notification_id, user_id, delete):
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            "UPDATE notifications SET is_read=TRUE WHERE id=%s AND recipient_user_id=%s",
            (notification_id, user_id),
        )
        if cursor.rowcount == 0:
            return jsonify({"error": "Notification not found."}), 404
        connection.commit()
        return jsonify({"message": "Notification marked as read."}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while marking notification read")
        return jsonify({"error": "Notification could not be updated."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.delete("/api/notifications/<int:notification_id>")
def delete_notification(notification_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("DELETE FROM notifications WHERE id=%s AND recipient_user_id=%s", (notification_id, user_id))
        if cursor.rowcount == 0: return jsonify({"error": "Notification not found."}), 404
        connection.commit()
        return jsonify({"message": "Notification deleted."}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while deleting notification")
        return jsonify({"error": "Notification could not be deleted."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.put("/api/code/<int:code_id>")
def update_code_space(code_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    values, error = parse_code_input(request.get_json(silent=True) or {})
    if error: return jsonify({"error": error}), 400
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            "UPDATE code_spaces SET title=%s, description=%s, language=%s, code=%s, visibility=%s WHERE id=%s AND user_id=%s",
            (values["title"], values["description"], values["language"], values["code"], values["visibility"], code_id, user_id),
        )
        cursor.execute("SELECT id FROM code_spaces WHERE id=%s AND user_id=%s", (code_id, user_id))
        if not cursor.fetchone(): return jsonify({"error": "Code space not found."}), 404
        record_activity(cursor, user_id, "CODE_UPDATED", f'You updated a Code Space: "{values["title"]}"', "code", code_id)
        connection.commit()
        return jsonify({"message": "Code space updated successfully."}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while updating a code space")
        return jsonify({"error": "The code space could not be updated."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


def update_visibility(table, item_id, user_id):
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            f"UPDATE {table} SET visibility='public' WHERE id=%s AND user_id=%s",
            (item_id, user_id),
        )
        if cursor.rowcount == 0:
            return jsonify({"error": "Item not found or you are not the owner."}), 404
        connection.commit()
        return jsonify({"message": "Item is now public.", "visibility": "public"}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while changing visibility")
        return jsonify({"error": "The item visibility could not be updated."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


@app.patch("/api/notes/<int:note_id>/visibility")
def make_note_public(note_id):
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401
    return update_visibility("notes", note_id, user_id)


@app.patch("/api/code/<int:code_id>/visibility")
def make_code_public(code_id):
    user_id = get_current_user_id()
    if user_id is None:
        return jsonify({"error": "Authentication is required."}), 401
    return update_visibility("code_spaces", code_id, user_id)


@app.delete("/api/code/<int:code_id>")
def delete_code_space(code_id):
    user_id = get_current_user_id()
    if user_id is None: return jsonify({"error": "Authentication is required."}), 401
    connection = cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("DELETE FROM code_spaces WHERE id=%s AND user_id=%s", (code_id, user_id))
        if cursor.rowcount == 0: return jsonify({"error": "Code space not found."}), 404
        connection.commit()
        return jsonify({"message": "Code space deleted successfully."}), 200
    except mysql.connector.Error:
        app.logger.exception("Database error while deleting a code space")
        return jsonify({"error": "The code space could not be deleted."}), 503
    finally:
        if cursor: cursor.close()
        if connection and connection.is_connected(): connection.close()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
