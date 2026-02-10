/**
 * LSAF-HR MANAGEMENT SYSTEM - FULL BACKEND SERVER
 * Version: 9.2.0
 * System: Integrated Human Resource Management
 * Modules: 
 * - Employee/Staff Management (CRUD)
 * - Attendance Tracking (Geofencing & Email Alerts)
 * - Payroll Management (11-column financial matrix)
 * - Loan Management (Request, Approval, Debt Tracking)
 * - Leave Management (Request, Approval, Balance Sync)
 * - Discussion Board (Real-time communication)
 * * Database: MySQL
 */

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// Database Connection Pool configuration
// Ensures persistent connections and handles reconnection logic
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', 
    database: process.env.DB_NAME || 'hr_management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

/**
 * EMAIL CONFIGURATION
 * Transporter setup for automated system notifications (Gmail SMTP)
 */
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || '', 
        pass: process.env.EMAIL_PASS || ''
    }
});

/**
 * DATABASE MIGRATIONS
 * Automatically ensures all required tables and columns exist in the database.
 */
const runMigrations = () => {
    console.log("LSAFHR: Starting Database Migrations...");

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
            if (err) {
                // Error 1060 is "Duplicate column name", safe to ignore
                if (err.errno !== 1060) {
                    console.error("Migration Column Error:", err.message);
                }
            }
        });
    });

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
            if (err) console.error("Migration Table Error:", err.message);
        });
    });

    console.log("LSAFHR: Database Schema Verification Complete.");
};
runMigrations();

// --- API ENDPOINTS ---

/**
 * 1. ATTENDANCE MODULE
 */

// Log attendance entry with geofencing data
app.post('/api/attendance', (req, res) => {
    const { employee_id, type, date_str, time_str, latitude, longitude } = req.body;
    const sql = `INSERT INTO attendance (employee_id, type, date_str, time_str, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)`;
    
    db.query(sql, [employee_id, type, date_str, time_str, latitude, longitude], (err) => {
        if (err) {
            console.error("Attendance Insert Error:", err);
            return res.status(500).json({ success: false, error: "Database error occurred" });
        }

        // Async Email Notification
        db.query('SELECT name, email FROM employees WHERE id = ?', [employee_id], (err, results) => {
            if (!err && results.length > 0 && results[0].email) {
                const emp = results[0];
                transporter.sendMail({
                    from: `"LSAFHR System" <${process.env.EMAIL_USER}>`,
                    to: emp.email,
                    subject: `Attendance Alert: ${type}`,
                    html: `<h3>Attendance Confirmed</h3><p>Hello ${emp.name}, your <b>${type}</b> at ${time_str} on ${date_str} has been successfully recorded in the system.</p>`
                }, (mailErr) => {
                    if (mailErr) console.warn("Mailer Notification Failed:", mailErr.message);
                });
            }
        });

        return res.json({ success: true, message: "Attendance recorded" });
    });
});

// Fetch attendance history for a specific employee
app.get('/api/attendance/:id', (req, res) => {
    const sql = 'SELECT * FROM attendance WHERE employee_id = ? ORDER BY id DESC';
    db.query(sql, [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

/**
 * 2. STAFF MANAGEMENT MODULE
 */

// Get all employees
app.get('/api/employees', (req, res) => {
    db.query('SELECT * FROM employees ORDER BY id ASC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

// Create new employee identity
app.post('/api/employees', (req, res) => {
    const sql = 'INSERT INTO employees SET ?';
    db.query(sql, req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Notify new employee via email
        if (req.body.email) {
            transporter.sendMail({
                from: `"LSAFHR System"`,
                to: req.body.email,
                subject: `Your LSAFHR Account Access`,
                html: `<p>Welcome to the team! Your account has been created.</p><p><b>Login ID:</b> ${req.body.id}<br><b>System Key:</b> ${req.body.password}</p>`
            }, (mailErr) => {
                if (mailErr) console.warn("Welcome Email Failed:", mailErr.message);
            });
        }
        res.json({ success: true });
    });
});

// Update employee details (including salary matrix)
app.put('/api/employees/:id', (req, res) => {
    const data = { ...req.body };
    const empId = req.params.id;
    delete data.id; // Prevent updating primary key

    db.query('UPDATE employees SET ? WHERE id = ?', [data, empId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Delete employee record
app.delete('/api/employees/:id', (req, res) => {
    db.query('DELETE FROM employees WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

/**
 * 3. LOAN MANAGEMENT MODULE
 */

// Submit a new loan request
app.post('/api/loans', (req, res) => {
    const { employeeId, amount, reason } = req.body;
    const sql = 'INSERT INTO loans (employee_id, amount, reason) VALUES (?, ?, ?)';
    
    db.query(sql, [employeeId, amount, reason], (err) => {
        if (err) {
            console.error("Loan Request Error:", err);
            return res.status(500).json({ success: false, error: err.message });
        }

        // Notify Admin of new request
        transporter.sendMail({
            from: `"LSAFHR System"`,
            to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
            subject: `New Loan Request: ${employeeId}`,
            html: `<h3>New Loan Application</h3><p>Employee <b>${employeeId}</b> has requested a loan of <b>Rs. ${amount}</b>.</p><p><b>Reason:</b> ${reason}</p>`
        }, (mailErr) => {
            if (mailErr) console.warn("Admin Notification Failed:", mailErr.message);
        });

        res.json({ success: true });
    });
});

// Get individual loan history
app.get('/api/loans/:id', (req, res) => {
    db.query('SELECT * FROM loans WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, r) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(r || []);
    });
});

// Admin: Get all loan requests
app.get('/api/admin/loans', (req, res) => {
    const sql = `SELECT l.*, e.name FROM loans l JOIN employees e ON l.employee_id = e.id ORDER BY l.id DESC`;
    db.query(sql, (err, r) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(r || []);
    });
});

// Admin: Update loan status
app.put('/api/admin/loans/:id', (req, res) => {
    const { status } = req.body;
    const loanId = req.params.id;

    db.query('UPDATE loans SET status = ? WHERE id = ?', [status, loanId], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        // Fetch info to notify employee and update balance
        const query = `SELECT l.employee_id, e.email, e.name, l.amount FROM loans l JOIN employees e ON l.employee_id = e.id WHERE l.id = ?`;
        db.query(query, [loanId], (err, results) => {
            if (!err && results.length > 0) {
                const ln = results[0];
                // Notify employee
                transporter.sendMail({
                    from: `"LSAFHR System"`,
                    to: ln.email,
                    subject: `Loan Application Update`,
                    html: `<p>Dear ${ln.name}, your loan request for Rs. ${ln.amount} has been <b>${status}</b>.</p>`
                }, (mErr) => {});
            }
        });
        res.json({ success: true });
    });
});

/**
 * 4. LEAVE MANAGEMENT MODULE
 */

app.post('/api/leaves', (req, res) => {
    const { employeeId, type, startDate, days, reason } = req.body;
    const sql = 'INSERT INTO leaves (employee_id, leave_type, start_date, days, reason) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [employeeId, type, startDate, days, reason], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/leaves/:id', (req, res) => {
    db.query('SELECT * FROM leaves WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, r) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(r || []);
    });
});

app.get('/api/admin/leaves', (req, res) => {
    const sql = `SELECT l.*, e.name, e.leave_annual, e.leave_casual FROM leaves l JOIN employees e ON l.employee_id = e.id ORDER BY l.id DESC`;
    db.query(sql, (err, r) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(r || []);
    });
});

app.put('/api/admin/leaves/:id', (req, res) => {
    const { status } = req.body;
    db.query('SELECT * FROM leaves WHERE id = ?', [req.params.id], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: "Leave not found" });
        const leave = results[0];
        db.query('UPDATE leaves SET status = ? WHERE id = ?', [status, req.params.id], (err) => {
            if (status === 'Approved') {
                const col = leave.leave_type === 'Annual Leave' ? 'leave_annual' : 'leave_casual';
                db.query(`UPDATE employees SET ${col} = ${col} - ? WHERE id = ?`, [leave.days, leave.employee_id]);
            }
            res.json({ success: true });
        });
    });
});

/**
 * 5. DISCUSSION BOARD MODULE
 */

app.get('/api/discussions', (req, res) => {
    db.query('SELECT * FROM discussions ORDER BY id DESC LIMIT 50', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

app.post('/api/discussions', (req, res) => {
    db.query('INSERT INTO discussions SET ?', req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

/**
 * 6. PAYROLL POSTING CONTROL
 */

app.get('/api/payroll-posted', (req, res) => {
    db.query('SELECT month_year FROM payroll_posts', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json((results || []).map(x => x.month_year));
    });
});

app.post('/api/payroll-post', (req, res) => {
    db.query('INSERT IGNORE INTO payroll_posts (month_year) VALUES (?)', [req.body.month], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/payroll-post/:month', (req, res) => {
    db.query('DELETE FROM payroll_posts WHERE month_year = ?', [req.params.month], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Server Initialization
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
    console.log(`----------------------------------------`);
    console.log(`LSAFHR Backend Server Active on Port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`----------------------------------------`);
});
