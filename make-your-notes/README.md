# makeYourNotes

A small learning project: React + Vite frontend, Flask backend, and MySQL database.

## 1. MySQL setup

Open MySQL Workbench or the MySQL command line and run:

```sql
CREATE DATABASE user_platform;
USE user_platform;

CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  username VARCHAR(50) UNIQUE,
  bio VARCHAR(500),
  college VARCHAR(255),
  course VARCHAR(255),
  skills VARCHAR(500),
  github VARCHAR(500),
  linkedin VARCHAR(500),
  profile_picture VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  subject VARCHAR(100),
  tags VARCHAR(500),
  visibility ENUM('private', 'public') NOT NULL DEFAULT 'private',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_notes_user_created (user_id, created_at),
  INDEX idx_notes_user_updated (user_id, updated_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE code_spaces (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(1000),
  language VARCHAR(30) NOT NULL,
  code MEDIUMTEXT NOT NULL,
  visibility ENUM('private', 'public') NOT NULL DEFAULT 'private',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code_spaces_user_updated (user_id, updated_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE note_likes (
  note_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (note_id, user_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE note_bookmarks (
  note_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (note_id, user_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE note_comments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  note_id INT NOT NULL,
  user_id INT NOT NULL,
  content VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Code Space likes and bookmarks use the same owner/user relationship pattern:

```sql
CREATE TABLE code_likes (
  code_space_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (code_space_id, user_id),
  FOREIGN KEY (code_space_id) REFERENCES code_spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE code_bookmarks (
  code_space_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (code_space_id, user_id),
  FOREIGN KEY (code_space_id) REFERENCES code_spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Run `python migrate.py` from `backend` to create these tables idempotently.

Comments are stored in the existing `note_comments` table and the
`code_comments` table created by the migration. Both are restricted to public
content by the Flask API, and users can delete only their own comments.
Personal activity is stored in `activities` and returned by `GET /api/activity`
for the authenticated user.
Notifications are stored in `notifications` and are generated for likes,
bookmarks, and comments on the owner's public notes and Code Spaces. The
authenticated notification APIs are:

- `GET /api/notifications`
- `GET /api/notifications/unread-count`
- `PUT /api/notifications/<id>/read`
- `PUT /api/notifications/read-all`
- `DELETE /api/notifications/<id>`

Notification queries are scoped to the authenticated user's `X-User-Id`
header; self-actions do not create notifications.

Follow relationships are stored in `follows` with a unique
`(follower_id, following_id)` constraint. Follow APIs are:

- `POST /api/users/<id>/follow`
- `DELETE /api/users/<id>/follow`
- `GET /api/users/<id>/followers`
- `GET /api/users/<id>/following`
- `GET /api/users/<id>/follow-status`

Successful follows create a `USER_FOLLOWED` activity and notification for the
target user. Self-follow and duplicate relationships are rejected server-side.

For an existing database, add the Phase 2 profile columns once:

```sql
ALTER TABLE users
  ADD COLUMN username VARCHAR(50) UNIQUE,
  ADD COLUMN bio VARCHAR(500),
  ADD COLUMN college VARCHAR(255),
  ADD COLUMN course VARCHAR(255),
  ADD COLUMN skills VARCHAR(500),
  ADD COLUMN github VARCHAR(500),
  ADD COLUMN linkedin VARCHAR(500),
  ADD COLUMN profile_picture VARCHAR(500);
```

For an existing database, create the Notes table once:

```sql
CREATE TABLE notes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  subject VARCHAR(100),
  tags VARCHAR(500),
  visibility ENUM('private', 'public') NOT NULL DEFAULT 'private',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_notes_user_created (user_id, created_at),
  INDEX idx_notes_user_updated (user_id, updated_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

For an existing database, create the Code Spaces table once:

```sql
CREATE TABLE code_spaces (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(1000),
  language VARCHAR(30) NOT NULL,
  code MEDIUMTEXT NOT NULL,
  visibility ENUM('private', 'public') NOT NULL DEFAULT 'private',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code_spaces_user_updated (user_id, updated_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Public sharing uses these unauthenticated URLs:

```text
/public/note/<id>
/public/code/<id>
```

The Flask public endpoints only return records whose database visibility is
`public`; private records return a not-found response even when their numeric
ID is known.

Explore is available at `/explore` and searches public notes, Code Spaces,
subjects, and usernames through the Flask API. Public profiles are available
at `/user/<username>` and include only public notes and Code Spaces.

For existing databases, create the community tables once using the same
definitions above. Community APIs include `/api/stats` and `/api/activity`;
likes, bookmarks, and comments are only allowed for public notes.

The password column stores a Werkzeug password hash, never the original password.
Users can upload a JPEG, PNG, or WebP profile image (up to 5 MB) from their
profile editor. Uploaded files are stored in `backend/uploads/` and served by
the Flask app; the folder is excluded from version control.
Each note supports up to 50 titled pages. Pages have formatted paragraphs,
headings, bold, italic, underline, lists, quotes, and highlighting. Existing
plain-text notes remain editable and are converted to a first page when saved.
Each page also has a drawing canvas with pen colors and sizes, an eraser, undo,
and clear. Drawings are saved with their page and shown on owned and public
notes. Users can independently hide or restore the text editor and canvas on
each page; hidden sections keep their content and are not shown in the saved
note. Each drawing is limited to 2 MB and a complete note to 12 MB.

## 2. Start the Flask backend (Windows PowerShell)

From the project root:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Open `backend/.env` and set your MySQL values. With the credentials supplied for this project, use:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root123
DB_NAME=user_platform
```

Apply the idempotent schema migration before starting Flask:

```powershell
python migrate.py
```

This adds the profile columns to `users` and creates the existing application
tables only when they are missing. It does not create duplicate user records.

Then start Flask:

```powershell
python app.py
```

If PowerShell blocks activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` once in that terminal, then activate again.

The API runs at `http://127.0.0.1:5000`. Check it at `http://127.0.0.1:5000/api/health`.

## 3. Start the React frontend

Open a second PowerShell terminal at the project root:

```powershell
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`.

## How it works

React displays the pages and sends JSON requests with `fetch()` to Flask. Flask validates the request, hashes passwords with Werkzeug, and uses the MySQL connector to insert or find users in MySQL. Flask sends a friendly JSON success or error response back to React. React displays that response to the user.

## Folder structure

```text
project-root/
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.jsx
│   │   │   ├── Register.jsx
│   │   │   ├── Login.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   ├── DashboardHome.jsx
│   │   │   ├── Profile.jsx
│   │   │   └── Placeholder.jsx
│   │   ├── App.jsx
│   │   ├── auth.js
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── app.py
│   ├── database.py
│   ├── requirements.txt
│   └── .env.example
├── .gitignore
└── README.md
```

## Dashboard

After a successful login, the frontend stores the returned user profile in
browser storage and redirects to `/dashboard`. The dashboard includes
workspace navigation, responsive overview cards, quick actions, a profile
page, and placeholder pages for notes, code spaces, and settings. The
dashboard routes are protected and redirect unauthenticated visitors to
`/login`. Logging out clears the stored session and returns to the login page.
