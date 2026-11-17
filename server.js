const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();

// PORT: starts at 3002 and automatically tries another port if busy.
const START_PORT = Number(process.env.PORT) || 3002;
const DATA_DIR = path.join(__dirname, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const SECRET = process.env.SESSION_SECRET ||
    'campus-event-hub-development-secret-change-before-deployment';

const db = new Database(
    path.join(DATA_DIR, 'campus-events.sqlite')
);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'student'
    );

    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        venue TEXT NOT NULL,
        description TEXT NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 100,
        accent TEXT NOT NULL DEFAULT '#a7e8d2'
    );

    CREATE TABLE IF NOT EXISTS registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        event_id INTEGER NOT NULL REFERENCES events(id),
        token_hash TEXT NOT NULL UNIQUE,
        checked_in_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, event_id)
    );
`);

// --------------------------------------------------
// SAMPLE EVENTS
// --------------------------------------------------

const eventCount = db.prepare(
    'SELECT COUNT(*) AS total FROM events'
).get().total;

if (eventCount === 0) {
    const insertEvent = db.prepare(`
        INSERT INTO events
        (title, category, date, time, venue,
         description, capacity, accent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const sampleEvents = [
        [
            'Indie Film Night',
            'Arts & Culture',
            '2026-11-18',
            '18:30',
            'Open Air Amphitheatre',
            'An evening of short films made by students.',
            120,
            '#f4c66e'
        ],
        [
            'Build for Good: Hackathon',
            'Technology',
            '2026-11-21',
            '09:00',
            'Innovation Lab - Block C',
            'A 12-hour collaborative campus hackathon.',
            80,
            '#b5a4ef'
        ],
        [
            'The Green Campus Walk',
            'Community',
            '2026-11-23',
            '07:30',
            'Meet at the Clock Tower',
            'Discover campus gardens and local birds.',
            40,
            '#91d7b7'
        ],
        [
            'Acoustic Courtyard Sessions',
            'Music',
            '2026-11-26',
            '17:00',
            'Library Courtyard',
            'Live music performances by campus students.',
            90,
            '#ed9f8e'
        ]
    ];

    const insertMany = db.transaction(events => {
        events.forEach(event => insertEvent.run(...event));
    });

    insertMany(sampleEvents);
}

// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
    store: new SQLiteStore({
        db: 'sessions.sqlite',
        dir: DATA_DIR
    }),
    secret: SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

// --------------------------------------------------
// HELPER FUNCTIONS
// --------------------------------------------------

const hashToken = token =>
    crypto.createHash('sha256').update(token).digest('hex');

const createTicketToken = registration => {
    return crypto.createHmac('sha256', SECRET)
        .update(`${registration.id}${registration.token_hash}`)
        .digest('base64url');
};

function auth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            error: 'Please sign in first.'
        });
    }
    next();
}

function organizer(req, res, next) {
    if (req.session.user?.role !== 'organizer') {
        return res.status(403).json({
            error: 'Organizer access required.'
        });
    }
    next();
}

// --------------------------------------------------
// CURRENT USER
// --------------------------------------------------

app.get('/api/me', (req, res) => {
    res.json({
        user: req.session.user || null
    });
});

// --------------------------------------------------
// SIGN UP
// --------------------------------------------------

app.post('/api/signup', (req, res, next) => {
    try {
        const name = String(req.body.name || '')
            .trim().slice(0, 80);

        const email = String(req.body.email || '')
            .trim().toLowerCase().slice(0, 160);

        if (
            name.length < 2 ||
            !/^\S+@\S+\.\S+$/.test(email)
        ) {
            return res.status(400).json({
                error: 'Enter your name and a valid email.'
            });
        }

        const organizerEmail = String(
            process.env.ORGANIZER_EMAIL || ''
        ).trim().toLowerCase();

        const role =
            organizerEmail && email === organizerEmail
                ? 'organizer'
                : 'student';

        const result = db.prepare(`
            INSERT INTO users (name, email, role)
            VALUES (?, ?, ?)
        `).run(name, email, role);

        req.session.user = {
            id: Number(result.lastInsertRowid),
            name,
            email,
            role
        };

        req.session.save(err => {
            if (err) return next(err);
            res.status(201).json({
                user: req.session.user
            });
        });

    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({
                error: 'Email already registered. Please sign in.'
            });
        }
        next(error);
    }
});

// --------------------------------------------------
// LOGIN
// --------------------------------------------------

app.post('/api/login', (req, res, next) => {
    try {
        const email = String(req.body.email || '')
            .trim().toLowerCase();

        const user = db.prepare(`
            SELECT id, name, email, role
            FROM users
            WHERE email = ?
        `).get(email);

        if (!user) {
            return res.status(401).json({
                error: 'Account not found. Please sign up.'
            });
        }

        req.session.user = user;

        req.session.save(err => {
            if (err) return next(err);
            res.json({ user });
        });

    } catch (error) {
        next(error);
    }
});

// --------------------------------------------------
// LOGOUT
// --------------------------------------------------

app.post('/api/logout', (req, res, next) => {
    req.session.destroy(err => {
        if (err) return next(err);

        res.clearCookie('connect.sid');
        res.json({ ok: true });
    });
});

// --------------------------------------------------
// GET ALL EVENTS
// --------------------------------------------------

app.get('/api/events', (req, res, next) => {
    try {
        const rows = db.prepare(`
            SELECT
                e.*,

                (
                    SELECT COUNT(*)
                    FROM registrations r
                    WHERE r.event_id = e.id
                ) AS attendees,

                EXISTS (
                    SELECT 1
                    FROM registrations r
                    WHERE r.event_id = e.id
                    AND r.user_id = ?
                ) AS registered

            FROM events e
            ORDER BY e.date, e.time
        `).all(req.session.user?.id || 0);

        res.json(rows);

    } catch (error) {
        next(error);
    }
});

// --------------------------------------------------
// CREATE EVENT
// --------------------------------------------------

app.post('/api/events', auth, organizer, (req, res, next) => {
    try {
        const {
            title,
            category,
            date,
            time,
            venue,
            description,
            capacity
        } = req.body;

        if (
            ![title, category, date, time, venue, description]
                .every(value =>
                    typeof value === 'string' && value.trim()
                ) ||
            !Number.isInteger(Number(capacity)) ||
            Number(capacity) < 1 ||
            Number(capacity) > 100000 ||
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            !/^\d{2}:\d{2}$/.test(time)
        ) {
            return res.status(400).json({
                error: 'Please complete all event fields correctly.'
            });
        }

        db.prepare(`
            INSERT INTO events
            (title, category, date, time, venue,
             description, capacity, accent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            title.trim(),
            category.trim(),
            date,
            time,
            venue.trim(),
            description.trim(),
            Number(capacity),
            '#b5a4ef'
        );

        res.status(201).json({
            ok: true,
            message: 'Event published successfully.'
        });

    } catch (error) {
        next(error);
    }
});

// --------------------------------------------------
// REGISTER FOR EVENT
// --------------------------------------------------

app.post('/api/events/:id/register', auth, (req, res, next) => {
    try {
        const eventId = Number(req.params.id);

        if (!Number.isInteger(eventId) || eventId < 1) {
            return res.status(400).json({
                error: 'Invalid event ID.'
            });
        }

        const register = db.transaction(() => {
            const event = db.prepare(
                'SELECT * FROM events WHERE id = ?'
            ).get(eventId);

            if (!event) {
                throw new Error('EVENT_NOT_FOUND');
            }

            const existing = db.prepare(`
                SELECT id FROM registrations
                WHERE user_id = ? AND event_id = ?
            `).get(req.session.user.id, eventId);

            if (existing) {
                throw new Error('ALREADY_REGISTERED');
            }

            const attendees = db.prepare(`
                SELECT COUNT(*) AS total
                FROM registrations
                WHERE event_id = ?
            `).get(eventId).total;

            if (attendees >= event.capacity) {
                throw new Error('EVENT_FULL');
            }

            const token = crypto.randomBytes(32).toString('base64url');

            db.prepare(`
                INSERT INTO registrations
                (user_id, event_id, token_hash)
                VALUES (?, ?, ?)
            `).run(
                req.session.user.id,
                eventId,
                hashToken(token)
            );

            return true;
        });

        register();

        res.status(201).json({
            ok: true,
            message: 'Registration successful.'
        });

    } catch (error) {
        const errors = {
            EVENT_NOT_FOUND: [404, 'Event not found.'],
            ALREADY_REGISTERED: [409, 'You are already registered.'],
            EVENT_FULL: [409, 'This event is full.']
        };

        if (errors[error.message]) {
            const [status, message] = errors[error.message];
            return res.status(status).json({ error: message });
        }

        next(error);
    }
});

// --------------------------------------------------
// CANCEL REGISTRATION
// --------------------------------------------------

app.delete('/api/events/:id/register', auth, (req, res, next) => {
    try {
        db.prepare(`
            DELETE FROM registrations
            WHERE user_id = ? AND event_id = ?
        `).run(req.session.user.id, Number(req.params.id));

        res.json({ ok: true });

    } catch (error) {
        next(error);
    }
});

// --------------------------------------------------
// MY TICKETS
// --------------------------------------------------

app.get('/api/my-tickets', auth, async (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT
                r.id,
                r.event_id,
                r.token_hash,
                r.checked_in_at,
                e.title,
                e.category,
                e.date,
                e.time,
                e.venue

            FROM registrations r

            JOIN events e ON e.id = r.event_id

            WHERE r.user_id = ?

            ORDER BY e.date, e.time
        `).all(req.session.user.id);

        const tickets = await Promise.all(
            rows.map(async registration => {
                const token = createTicketToken(registration);

                const qr = await QRCode.toDataURL(
                    `CEH:${token}`,
                    {
                        width: 240,
                        margin: 1,
                        color: {
                            dark: '#183c34',
                            light: '#ffffff'
                        }
                    }
                );

                return {
                    ...registration,
                    token: `CEH:${token}`,
                    qr
                };
            })
        );

        res.json(tickets);

    } catch (error) {
        console.error('Ticket error:', error);

        res.status(500).json({
            error: 'Unable to load tickets.'
        });
    }
});

// --------------------------------------------------
// ORGANIZER CHECK-IN
// --------------------------------------------------

app.post('/api/checkin', auth, organizer, (req, res, next) => {
    try {
        const token = String(req.body.token || '').trim();

        if (!token.startsWith('CEH:')) {
            return res.status(400).json({
                error: 'Invalid Campus Event Hub QR ticket.'
            });
        }

        const candidate = token.slice(4);

        const rows = db.prepare(`
            SELECT
                r.id,
                r.token_hash,
                r.checked_in_at,
                e.title,
                e.date,
                u.name

            FROM registrations r

            JOIN events e ON e.id = r.event_id
            JOIN users u ON u.id = r.user_id
        `).all();

        const ticket = rows.find(row => {
            const expected = createTicketToken(row);

            const givenBytes = Buffer.from(candidate);
            const expectedBytes = Buffer.from(expected);

            return (
                givenBytes.length === expectedBytes.length &&
                crypto.timingSafeEqual(givenBytes, expectedBytes)
            );
        });

        if (!ticket) {
            return res.status(404).json({
                error: 'Ticket not found. Please scan a valid ticket.'
            });
        }

        if (ticket.checked_in_at) {
            return res.status(409).json({
                error: `Already checked in: ${ticket.name} - ${ticket.title}.`
            });
        }

        const result = db.prepare(`
            UPDATE registrations
            SET checked_in_at = CURRENT_TIMESTAMP
            WHERE id = ? AND checked_in_at IS NULL
        `).run(ticket.id);

        if (result.changes === 0) {
            return res.status(409).json({
                error: 'This ticket has already been checked in.'
            });
        }

        res.json({
            ok: true,
            name: ticket.name,
            event: ticket.title,
            date: ticket.date
        });

    } catch (error) {
        next(error);
    }
});

// --------------------------------------------------
// ORGANIZER STATISTICS
// --------------------------------------------------

app.get('/api/stats', auth, organizer, (req, res, next) => {
    try {
        const events = db.prepare(
            'SELECT COUNT(*) AS n FROM events'
        ).get().n;

        const registrations = db.prepare(
            'SELECT COUNT(*) AS n FROM registrations'
        ).get().n;

        const checkedIn = db.prepare(`
            SELECT COUNT(*) AS n
            FROM registrations
            WHERE checked_in_at IS NOT NULL
        `).get().n;

        res.json({
            events,
            registrations,
            checkedIn
        });

    } catch (error) {
        next(error);
    }
});

// --------------------------------------------------
// WEBSITE FALLBACK
// --------------------------------------------------

app.use((req, res, next) => {
    if (req.method !== 'GET') {
        return res.status(404).json({
            error: 'API endpoint not found.'
        });
    }

    res.sendFile(
        path.join(__dirname, 'public', 'index.html'),
        error => {
            if (error) next(error);
        }
    );
});

// --------------------------------------------------
// ERROR HANDLER
// --------------------------------------------------

app.use((error, req, res, next) => {
    console.error('Server error:', error);

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({
        error: 'Server error. Please try again.'
    });
});

// --------------------------------------------------
// START SERVER WITH PORT FALLBACK
// --------------------------------------------------

function startServer(port) {
    const server = app.listen(port, '0.0.0.0');

    server.on('listening', () => {
        const address = server.address();

        console.log('\n================================');
        console.log('Campus Event Hub started!');
        console.log(`Website: http://localhost:${address.port}`);
        console.log('================================\n');
    });

    server.on('error', error => {
        if (error.code === 'EADDRINUSE') {
            console.log(`Port ${port} is busy. Trying ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('Server startup failed:', error);
        }
    });
}

startServer(START_PORT);