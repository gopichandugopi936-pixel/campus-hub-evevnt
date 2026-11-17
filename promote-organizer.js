const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

// Use the SAME database as server.js
const dbPath = path.join(
    __dirname,
    "data",
    "campus-events.sqlite"
);

if (!fs.existsSync(dbPath)) {
    console.log("ERROR: Database file not found:", dbPath);
    process.exit(1);
}

const db = new Database(dbPath);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

try {
    // Check users table columns
    const columns = db.prepare(
        "PRAGMA table_info(users)"
    ).all();

    if (!columns.length) {
        throw new Error("Users table does not exist.");
    }

    // Add role column if it does not exist
    const hasRole = columns.some(
        column => column.name === "role"
    );

    if (!hasRole) {
        db.exec(`
            ALTER TABLE users
            ADD COLUMN role TEXT NOT NULL DEFAULT 'student'
        `);
    }

    // Show registered accounts
    const users = db.prepare(`
        SELECT id, name, email, role
        FROM users
    `).all();

    console.log("\n===== REGISTERED ACCOUNTS =====");
    console.table(users);

    rl.question(
        "\nEnter your second registered email: ",
        (email) => {
            try {
                email = email.trim().toLowerCase();

                const user = db.prepare(`
                    SELECT id, name, email, role
                    FROM users
                    WHERE LOWER(email) = ?
                `).get(email);

                if (!user) {
                    console.log("\nAccount not found.");
                    console.log(
                        "Register this email on the website first."
                    );
                } else if (user.role === "organizer") {
                    console.log("\nAlready an organizer!");
                } else {
                    db.prepare(`
                        UPDATE users
                        SET role = 'organizer'
                        WHERE id = ?
                    `).run(user.id);

                    console.log("\nSUCCESS!");
                    console.log("Name:", user.name);
                    console.log("Email:", user.email);
                    console.log("New role: ORGANIZER");
                }
            } catch (error) {
                console.log("Error:", error.message);
            } finally {
                db.close();
                rl.close();
            }
        }
    );

} catch (error) {
    console.log("Database error:", error.message);
    db.close();
    rl.close();
}