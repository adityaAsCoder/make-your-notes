import mysql.connector

from database import get_db_connection


STATEMENTS = [
    "ALTER TABLE users ADD COLUMN username VARCHAR(50) UNIQUE",
    "ALTER TABLE users ADD COLUMN bio VARCHAR(500)",
    "ALTER TABLE users ADD COLUMN college VARCHAR(255)",
    "ALTER TABLE users ADD COLUMN course VARCHAR(255)",
    "ALTER TABLE users ADD COLUMN skills VARCHAR(500)",
    "ALTER TABLE users ADD COLUMN github VARCHAR(500)",
    "ALTER TABLE users ADD COLUMN linkedin VARCHAR(500)",
    "ALTER TABLE users ADD COLUMN profile_picture VARCHAR(500)",
    """
    CREATE TABLE IF NOT EXISTS notes (
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
    )
    """,
    "ALTER TABLE notes MODIFY content MEDIUMTEXT NOT NULL",
    """
    CREATE TABLE IF NOT EXISTS code_spaces (
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
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS note_likes (
        note_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (note_id, user_id),
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS note_bookmarks (
        note_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (note_id, user_id),
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS note_comments (
        id INT PRIMARY KEY AUTO_INCREMENT,
        note_id INT NOT NULL,
        user_id INT NOT NULL,
        content VARCHAR(2000) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """,
    "ALTER TABLE note_comments MODIFY content VARCHAR(2000) NOT NULL",
    """
    CREATE TABLE IF NOT EXISTS code_likes (
        code_space_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (code_space_id, user_id),
        FOREIGN KEY (code_space_id) REFERENCES code_spaces(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS code_bookmarks (
        code_space_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (code_space_id, user_id),
        FOREIGN KEY (code_space_id) REFERENCES code_spaces(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS code_comments (
        id INT PRIMARY KEY AUTO_INCREMENT,
        code_space_id INT NOT NULL,
        user_id INT NOT NULL,
        content VARCHAR(2000) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (code_space_id) REFERENCES code_spaces(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS activities (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        activity_type VARCHAR(40) NOT NULL,
        description VARCHAR(500) NOT NULL,
        related_type VARCHAR(30),
        related_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_activities_user_created (user_id, created_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notifications (
        id INT PRIMARY KEY AUTO_INCREMENT,
        recipient_user_id INT NOT NULL,
        actor_user_id INT,
        notification_type VARCHAR(50) NOT NULL,
        related_type VARCHAR(50),
        related_id INT,
        message VARCHAR(500) NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_notifications_recipient_created (recipient_user_id, created_at),
        INDEX idx_notifications_recipient_read (recipient_user_id, is_read),
        FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS follows (
        id INT PRIMARY KEY AUTO_INCREMENT,
        follower_id INT NOT NULL,
        following_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_follows_pair (follower_id, following_id),
        INDEX idx_follows_following (following_id),
        FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """,
]


def migrate():
    connection = get_db_connection()
    cursor = connection.cursor()
    try:
        for statement in STATEMENTS:
            try:
                cursor.execute(statement)
            except mysql.connector.Error as error:
                if not statement.lstrip().upper().startswith("ALTER TABLE USERS ADD COLUMN"):
                    raise
                if "Duplicate column name" not in str(error):
                    raise
        connection.commit()
    finally:
        cursor.close()
        connection.close()


if __name__ == "__main__":
    migrate()
    print("Database schema is ready.")
