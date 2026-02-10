/**
 * ==============================================================================
 * LSAF-HR MANAGEMENT SYSTEM - ADVANCED BACKEND ENGINE
 * ==============================================================================
 * Version: 9.5.0
 * * DESCRIPTION:
 * This server handles the core business logic for the LSAFHR platform, including
 * employee lifecycle management, geofenced attendance, complex payroll 
 * calculations, loan/advance processing, and leave management.
 * * MODULES INCLUDED:
 * 1.  Employee Management (Full CRUD)
 * 2.  Attendance & Geolocation Tracking
 * 3.  Payroll Management (11-column financial matrix)
 * 4.  Loan & Advance System (Request/Approval Workflow)
 * 5.  Leave Management (Auto-deduction & Balance Tracking)
 * 6.  Discussion Board (Real-time internal communication)
 * 7.  Automated Email Notifications (Nodemailer integration)
 * * PORT: 5050
 * ==============================================================================
 */

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

/**
 * MIDDLEWARE CONFIGURATION
 * Enables cross-origin requests and parses incoming JSON payloads.
 */
app.use(cors());
app.use(express.json());

// Request Logging Middleware for Debugging
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} request to ${req.url}`);
    next();
});

/**
 * DATABASE CONNECTION POOL
 * Configured for high availability and automatic reconnection.
 */
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', 
    database: process.env.DB_NAME || 'hr_management',
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

/**
 * EMAIL TRANSPORTER CONFIGURATION
 * Uses Gmail SMTP. Ensure 'EMAIL_USER' and 'EMAIL_PASS' are set in .env.
 * Note: If credentials fail, the server will log the error but continue running.
 */
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || '', 
        pass: process.env.EMAIL_PASS || ''
    }
});

/**
 * AUTOMATED DATABASE MIGRATIONS
 * Ensures the MySQL schema matches the requirements of the v9.0.0+ frontend.
 */
const runMigrations = () => {
    console.log("LSAFHR: Initiating Database Schema Verification...");

    // 1. Column Migrations (Checking if specific columns exist, adding if missing)
    const columnMigrations = [
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS email VARCHAR(255)`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS password VARCHAR(255)`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'employee'`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS loan_opening_balance DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_annual INT DEFAULT 14`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_casual INT DEFAULT 10`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS basic_salary DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS invigilation DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS t_payment DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS increment DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS eidi DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS tax DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS loan_deduction DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS others_deduction DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS extra_leaves_deduction DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8)`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8)`
    ];

    columnMigrations.forEach(sql => {
        db.query(sql, (err) => {
            // Error 1060 is "Duplicate column name", we can ignore it safely.
            if (err && err.errno !== 1060) {
                console.error("Migration Warning (Column):", err.message);
            }
        });
    });

    // 2. Table Migrations (Ensuring required relational tables exist)
    const tableMigrations = [
        `CREATE TABLE IF NOT EXISTS payroll_posts (
            id INT AUTO_INCREMENT PRIMARY KEY, 
            month_year VARCHAR(10) UNIQUE, 
            posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS leaves (
            id INT AUTO_INCREMENT PRIMARY KEY, 
            employee_id VARCHAR(50), 
            leave_type VARCHAR(50), 
            start_date DATE, 
            days INT, 
            reason TEXT, 
            status VARCHAR(20) DEFAULT 'Pending', 
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS loans (
            id INT AUTO_INCREMENT PRIMARY KEY, 
            employee_id VARCHAR(50), 
            amount DECIMAL(15,2), 
            reason TEXT, 
            status VARCHAR(20) DEFAULT 'Pending', 
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS discussions (
            id INT AUTO_INCREMENT PRIMARY KEY, 
            employee_id VARCHAR(50), 
            author_name VARCHAR(255), 
            message TEXT, 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    ];

    tableMigrations.forEach(sql => {
        db.query(sql, (err) => {
            if (err) console.error("Migration Warning (Table):", err.message);
        });
    });

    console.log("LSAFHR: Database Schema is Up-to-Date.");
};

// Run migrations on startup
runMigrations();


/**
 * ==============================================================================
 * API ENDPOINTS
 * ==============================================================================
 */

/** 1. ATTENDANCE ENDPOINTS **/

// POST: Record a new attendance entry (Clock In / Clock Out)
app.post('/api/attendance', (req, res) => {
    const { employee_id, type, date_str, time_str, latitude, longitude } = req.body;
    const sql = `INSERT INTO attendance (employee_id, type, date_str, time_str, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)`;
    
    db.query(sql, [employee_id, type, date_str, time_str, latitude, longitude], (err) => {
        if (err) {
            console.error("Critical Database Error (Attendance):", err);
            return res.status(500).json({ success: false, error: err.message });
        }

        // Send Email Notification asynchronously
        db.query('SELECT name, email FROM employees WHERE id = ?', [employee_id], (err, results) => {
            if (!err && results.length > 0 && results[0].email) {
                const emp = results[0];
                try {
                    transporter.sendMail({
                        from: `"LSAFHR System" <${process.env.EMAIL_USER}>`,
                        to: emp.email,
                        subject: `Attendance Alert: ${type}`,
                        html: `<h3>Notification</h3><p>Hello ${emp.name}, your <b>${type}</b> has been recorded at ${time_str} on ${date_str}.</p>`
                    }, (mailErr) => {
                        if (mailErr) console.warn("Mailer Error (Attendance):", mailErr.message);
                    });
                } catch(e) { console.error("SMTP Error:", e.message); }
            }
        });
        res.json({ success: true, message: "Attendance logged successfully" });
    });
});

// GET: Retrieve attendance history for a specific employee
app.get('/api/attendance/:id', (req, res) => {
    const sql = 'SELECT * FROM attendance WHERE employee_id = ? ORDER BY id DESC';
    db.query(sql, [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});


/** 2. EMPLOYEE MANAGEMENT ENDPOINTS **/

// GET: Fetch all employee records
app.get('/api/employees', (req, res) => {
    db.query('SELECT * FROM employees ORDER BY id ASC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

// POST: Create a new employee profile
app.post('/api/employees', (req, res) => {
    const sql = 'INSERT INTO employees SET ?';
    db.query(sql, req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Notify new employee of their credentials
        if (req.body.email) {
            try {
                transporter.sendMail({
                    from: `"LSAFHR System"`,
                    to: req.body.email,
                    subject: `Welcome to LSAFHR - Account Credentials`,
                    html: `<p>Welcome! Your account is active.</p><p><b>Login ID:</b> ${req.body.id}<br><b>System Key:</b> ${req.body.password}</p>`
                }, (mailErr) => {
                    if (mailErr) console.warn("Mailer Error (New Employee):", mailErr.message);
                });
            } catch(e) {}
        }
        res.json({ success: true });
    });
});

// PUT: Update an existing employee's data (incl. Salary Matrix)
app.put('/api/employees/:id', (req, res) => {
    const data = { ...req.body };
    const empId = req.params.id;
    delete data.id; // Safety: Do not update primary key

    db.query('UPDATE employees SET ? WHERE id = ?', [data, empId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// DELETE: Remove an employee from the system
app.delete('/api/employees/:id', (req, res) => {
    db.query('DELETE FROM employees WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});


/** 3. LOAN MANAGEMENT ENDPOINTS **/

// POST: Submit a new loan/advance request
app.post('/api/loans', (req, res) => {
    const { employeeId, amount, reason } = req.body;
    const sql = 'INSERT INTO loans (employee_id, amount, reason) VALUES (?, ?, ?)';
    
    db.query(sql, [employeeId, amount, reason], (err) => {
        if (err) {
            console.error("Database Error (Loan Submit):", err);
            return res.status(500).json({ success: false, error: err.message });
        }

        // Notify Admin of the new request
        try {
            transporter.sendMail({
                from: `"LSAFHR System"`,
                to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
                subject: `NEW LOAN REQUEST: ${employeeId}`,
                html: `<h3>Loan Request Submitted</h3><p>Employee <b>${employeeId}</b> has requested a loan of <b>Rs. ${amount}</b>.</p><p><b>Reason:</b> ${reason}</p>`
            }, (mailErr) => {
                if (mailErr) console.warn("Mailer Error (Loan Admin):", mailErr.message);
            });
        } catch(e) {}

        res.json({ success: true });
    });
});

// GET: Get loan history for a specific employee
app.get('/api/loans/:id', (req, res) => {
    db.query('SELECT * FROM loans WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

// GET (ADMIN): View all pending and processed loan requests
app.get('/api/admin/loans', (req, res) => {
    const sql = `SELECT l.*, e.name FROM loans l JOIN employees e ON l.employee_id = e.id ORDER BY l.id DESC`;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

// PUT (ADMIN): Approve or Reject a loan request
app.put('/api/admin/loans/:id', (req, res) => {
    const { status } = req.body;
    const loanId = req.params.id;

    db.query('UPDATE loans SET status = ? WHERE id = ?', [status, loanId], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        // Retrieve employee details to send notification email
        const query = `SELECT l.employee_id, e.email, e.name, l.amount FROM loans l JOIN employees e ON l.employee_id = e.id WHERE l.id = ?`;
        db.query(query, [loanId], (err, results) => {
            if (!err && results.length > 0) {
                const ln = results[0];
                try {
                    transporter.sendMail({
                        from: `"LSAFHR System"`,
                        to: ln.email,
                        subject: `Loan Application Status: ${status}`,
                        html: `<p>Dear ${ln.name}, your loan request for Rs. ${ln.amount} has been <b>${status}</b>.</p>`
                    }, (mailErr) => {
                        if (mailErr) console.warn("Mailer Error (Loan Decision):", mailErr.message);
                    });
                } catch(e) {}
            }
        });
        res.json({ success: true });
    });
});


/** 4. LEAVE MANAGEMENT ENDPOINTS **/

// POST: Submit a new leave application
app.post('/api/leaves', (req, res) => {
    const { employeeId, type, startDate, days, reason } = req.body;
    const sql = 'INSERT INTO leaves (employee_id, leave_type, start_date, days, reason) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [employeeId, type, startDate, days, reason], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// GET: Get leave history for a specific employee
app.get('/api/leaves/:id', (req, res) => {
    db.query('SELECT * FROM leaves WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

// GET (ADMIN): View all leave requests with employee balances
app.get('/api/admin/leaves', (req, res) => {
    const sql = `SELECT l.*, e.name, e.leave_annual, e.leave_casual FROM leaves l JOIN employees e ON l.employee_id = e.id ORDER BY l.id DESC`;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

// PUT (ADMIN): Approve or Reject a leave request
app.put('/api/admin/leaves/:id', (req, res) => {
    const { status } = req.body;
    db.query('SELECT * FROM leaves WHERE id = ?', [req.params.id], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: "Leave application not found" });
        
        const leave = results[0];
        db.query('UPDATE leaves SET status = ? WHERE id = ?', [status, req.params.id], (err) => {
            // Auto-deduct from balance if approved
            if (status === 'Approved') {
                const column = leave.leave_type === 'Annual Leave' ? 'leave_annual' : 'leave_casual';
                db.query(`UPDATE employees SET ${column} = ${column} - ? WHERE id = ?`, [leave.days, leave.employee_id]);
            }
            res.json({ success: true });
        });
    });
});


/** 5. DISCUSSION BOARD ENDPOINTS **/

// GET: Retrieve last 50 messages
app.get('/api/discussions', (req, res) => {
    db.query('SELECT * FROM discussions ORDER BY id DESC LIMIT 50', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

// POST: Post a message to the board
app.post('/api/discussions', (req, res) => {
    db.query('INSERT INTO discussions SET ?', req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});


/** 6. PAYROLL CONTROL ENDPOINTS **/

// GET: List all months where payroll has been published
app.get('/api/payroll-posted', (req, res) => {
    db.query('SELECT month_year FROM payroll_posts', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json((results || []).map(x => x.month_year));
    });
});

// POST: Mark a month as published
app.post('/api/payroll-post', (req, res) => {
    db.query('INSERT IGNORE INTO payroll_posts (month_year) VALUES (?)', [req.body.month], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// DELETE: Unpublish a month
app.delete('/api/payroll-post/:month', (req, res) => {
    db.query('DELETE FROM payroll_posts WHERE month_year = ?', [req.params.month], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});


/** SERVER INITIALIZATION **/
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
    console.log(`========================================`);
    console.log(` LSAFHR BACKEND SERVER IS RUNNING`);
    console.log(` Port: ${PORT}`);
    console.log(` Status: Active`);
    console.log(`========================================`);
});
