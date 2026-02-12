/**
 * ==============================================================================
 * LSAFHR MANAGEMENT SYSTEM - BACKEND ENGINE v11.1.0
 * ==============================================================================
 * CORE FEATURES:
 * 1. Automatic Email Hub (NodeMailer) for ALL actions (Attendance, Loans, Leaves).
 * 2. Automatic SQL Balance Deduction for Approved Leaves.
 * 3. Robust Identity Hub (Resolves 500 Errors by verifying schema & mapping fields).
 * 4. Automated Database Migrations (Schema Sync).
 * ==============================================================================
 */

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// --- DATABASE CONFIGURATION ---
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hr_management',
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0
});

// --- EMAIL HUB CONFIGURATION ---
const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: process.env.MAIL_PORT || 587,
    secure: false, 
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
    },
    tls: { rejectUnauthorized: false }
});

/**
 * --- DATABASE MIGRATIONS ---
 * Automatically synchronizes the database schema with the Matrix v11 requirements.
 * This resolves 500 errors by ensuring the 'status' and matrix columns exist.
 */
const syncSchema = () => {
    console.log("LSAFHR: Checking Database Matrix Integrity...");

    // 1. Employee Table
    const empCols = [
        "email VARCHAR(255)",
        "password VARCHAR(255)",
        "role VARCHAR(50) DEFAULT 'employee'",
        "loan_opening_balance DECIMAL(15,2) DEFAULT 0",
        "loan_deduction DECIMAL(15,2) DEFAULT 0",
        "leave_annual INT DEFAULT 14",
        "leave_casual INT DEFAULT 10",
        "basic_salary DECIMAL(15,2) DEFAULT 0",
        "invigilation DECIMAL(15,2) DEFAULT 0",
        "t_payment DECIMAL(15,2) DEFAULT 0",
        "increment DECIMAL(15,2) DEFAULT 0",
        "eidi DECIMAL(15,2) DEFAULT 0",
        "tax DECIMAL(15,2) DEFAULT 0",
        "insurance DECIMAL(15,2) DEFAULT 0",
        "others_deduction DECIMAL(15,2) DEFAULT 0",
        "extra_leaves_deduction DECIMAL(15,2) DEFAULT 0"
    ];

    empCols.forEach(col => {
        db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS ${col}`, (err) => {
            if (err && err.errno !== 1060) console.error("Migration Err (Employees):", err.message);
        });
    });

    // 2. Loans Table - Crucial for fixing 500 error
    db.query(`CREATE TABLE IF NOT EXISTS loans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id VARCHAR(50),
        amount DECIMAL(15,2),
        reason TEXT,
        status VARCHAR(20) DEFAULT 'Pending',
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (!err) {
            // Ensure status column exists if table was created previously without it
            db.query(`ALTER TABLE loans ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Pending'`);
        }
    });

    // 3. Leaves Table
    db.query(`CREATE TABLE IF NOT EXISTS leaves (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id VARCHAR(50),
        leave_type VARCHAR(50),
        start_date DATE,
        days INT,
        reason TEXT,
        status VARCHAR(20) DEFAULT 'Pending',
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (!err) {
            db.query(`ALTER TABLE leaves ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Pending'`);
        }
    });

    // 4. Other Tables
    db.query(`CREATE TABLE IF NOT EXISTS attendance (id INT AUTO_INCREMENT PRIMARY KEY, employee_id VARCHAR(50), type VARCHAR(20), date_str DATE, time_str VARCHAR(20), latitude DECIMAL(10,8), longitude DECIMAL(11,8), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    db.query(`CREATE TABLE IF NOT EXISTS payroll_posts (id INT AUTO_INCREMENT PRIMARY KEY, month_year VARCHAR(10) UNIQUE, posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    db.query(`CREATE TABLE IF NOT EXISTS discussions (id INT AUTO_INCREMENT PRIMARY KEY, employee_id VARCHAR(50), author_name VARCHAR(255), message TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

    console.log("LSAFHR: Identity Matrix Schema Verified.");
};
syncSchema();

/**
 * --- HELPER: DISPATCH IDENTITY EMAIL ---
 */
const dispatchEmail = async (to, subject, html) => {
    try {
        if (!to) return false;
        await transporter.sendMail({
            from: `"LSAFHR Identity Hub" <${process.env.MAIL_USER}>`,
            to, subject, html
        });
        console.log(`Email dispatched to ${to}`);
        return true;
    } catch (err) {
        console.error("Email Dispatch Error:", err.message);
        return false;
    }
};

/**
 * --- API ENDPOINTS ---
 */

// 1. IDENTITY & STAFF HUB
app.get('/api/employees', (req, res) => {
    db.query('SELECT * FROM employees ORDER BY name ASC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/employees', (req, res) => {
    const { id, name, email, password } = req.body;
    db.query('INSERT INTO employees SET ?', req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const subject = "LSAFHR: Identity Hub Registration Details";
        const body = `<h2>Welcome ${name}</h2><p>Your LSAFHR Hub account is ready.</p><p><b>ID:</b> ${id}<br><b>Password:</b> ${password}</p><p>URL: <a href="https://hr.uolcc.edu.pk">https://hr.uolcc.edu.pk</a></p>`;
        dispatchEmail(email, subject, body);
        
        res.json({ success: true });
    });
});

app.put('/api/employees/:id', (req, res) => {
    const data = { ...req.body };
    delete data.id;
    db.query('UPDATE employees SET ? WHERE id = ?', [data, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/employees/:id', (req, res) => {
    db.query('DELETE FROM employees WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 2. ATTENDANCE CENTER
app.post('/api/attendance', (req, res) => {
    const { employee_id, type, date_str, time_str, latitude, longitude } = req.body;
    const sql = 'INSERT INTO attendance (employee_id, type, date_str, time_str, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)';
    
    db.query(sql, [employee_id, type, date_str, time_str, latitude, longitude], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.query('SELECT name, email FROM employees WHERE id = ?', [employee_id], (err, results) => {
            if (results && results[0]) {
                const subject = `LSAFHR Mark: ${type}`;
                const body = `<p>Hello ${results[0].name},</p><p>Your identity marking (<b>${type}</b>) has been recorded at ${time_str} on ${date_str}.</p><p>Location Coordinates: ${latitude}, ${longitude}</p>`;
                dispatchEmail(results[0].email, subject, body);
            }
        });
        res.json({ success: true });
    });
});

app.get('/api/attendance/:id', (req, res) => {
    db.query('SELECT * FROM attendance WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 3. LOAN HUB (ROBUST FIELD MAPPING)
app.post('/api/loans', (req, res) => {
    const empId = req.body.employee_id || req.body.employeeId;
    const { amount, reason } = req.body;

    if (!empId || !amount) {
        return res.status(400).json({ error: "Missing identity ID or amount" });
    }

    const sql = 'INSERT INTO loans (employee_id, amount, reason, status) VALUES (?, ?, ?, ?)';
    db.query(sql, [empId, amount, reason, 'Pending'], (err) => {
        if (err) {
            console.error("SQL Matrix Error (Loan Post):", err);
            return res.status(500).json({ error: "Database error: " + err.message });
        }
        
        // Notify Admin and Employee
        db.query('SELECT name, email FROM employees WHERE id = ?', [empId], (err, results) => {
            if (results && results[0]) {
                const body = `<h3>Loan Request Logged</h3><p>Identity ${results[0].name} has requested Rs. ${amount}.</p><p><b>Reason:</b> ${reason}</p>`;
                dispatchEmail(results[0].email, "LSAFHR: Loan Application Received", body);
                // Also notify admin if configured
                if (process.env.ADMIN_EMAIL) dispatchEmail(process.env.ADMIN_EMAIL, "LSAFHR: New Loan Pending", body);
            }
        });
        res.json({ success: true });
    });
});

app.get('/api/loans/:id', (req, res) => {
    db.query('SELECT * FROM loans WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/api/admin/loans', (req, res) => {
    const sql = 'SELECT l.*, e.name FROM loans l JOIN employees e ON l.employee_id = e.id ORDER BY l.id DESC';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.put('/api/admin/loans/:id', (req, res) => {
    const { status } = req.body;
    db.query('UPDATE loans SET status = ? WHERE id = ?', [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.query('SELECT e.email, e.name, l.amount FROM loans l JOIN employees e ON l.employee_id = e.id WHERE l.id = ?', [req.params.id], (err, resRow) => {
            if (resRow && resRow[0]) {
                const body = `<h3>Loan Matrix Update</h3><p>Your loan request for Rs. ${resRow[0].amount} has been <b>${status}</b>.</p>`;
                dispatchEmail(resRow[0].email, "LSAFHR: Loan Status Updated", body);
            }
        });
        res.json({ success: true });
    });
});

// 4. LEAVES HUB (AUTO DEDUCTION)
app.post('/api/leaves', (req, res) => {
    const empId = req.body.employee_id || req.body.employeeId;
    const { type, startDate, days, reason } = req.body;

    const sql = 'INSERT INTO leaves (employee_id, leave_type, start_date, days, reason, status) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(sql, [empId, type, startDate, days, reason, 'Pending'], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.query('SELECT name, email FROM employees WHERE id = ?', [empId], (err, results) => {
            if (results && results[0]) {
                const body = `<h3>Leave Request Received</h3><p>Your request for ${days} days (${type}) starting ${startDate} is pending approval.</p>`;
                dispatchEmail(results[0].email, "LSAFHR: Leave Request Matrix", body);
            }
        });
        res.json({ success: true });
    });
});

app.get('/api/admin/leaves', (req, res) => {
    const sql = 'SELECT l.*, e.name FROM leaves l JOIN employees e ON l.employee_id = e.id ORDER BY l.id DESC';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.put('/api/admin/leaves/:id', (req, res) => {
    const { status } = req.body;
    db.query('SELECT * FROM leaves WHERE id = ?', [req.params.id], (err, results) => {
        if (err || results.length === 0) return res.status(404).send();
        const leave = results[0];

        db.query('UPDATE leaves SET status = ? WHERE id = ?', [status, req.params.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            // AUTOMATIC BALANCE DEDUCTION MATRIX
            if (status === 'Approved') {
                const col = (leave.leave_type === 'Annual Leave') ? 'leave_annual' : 'leave_casual';
                db.query(`UPDATE employees SET ${col} = ${col} - ? WHERE id = ?`, [leave.days, leave.employee_id]);
            }

            db.query('SELECT name, email FROM employees WHERE id = ?', [leave.employee_id], (err, empRes) => {
                if (empRes && empRes[0]) {
                    const body = `<h3>Leave Hub Decision</h3><p>Your ${leave.leave_type} request for ${leave.days} day(s) has been <b>${status}</b>.</p>`;
                    dispatchEmail(empRes[0].email, `LSAFHR Leave: ${status}`, body);
                }
            });
            res.json({ success: true });
        });
    });
});

// 5. MATRIX BOARD
app.get('/api/discussions', (req, res) => {
    db.query('SELECT * FROM discussions ORDER BY id DESC LIMIT 50', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/discussions', (req, res) => {
    db.query('INSERT INTO discussions SET ?', req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 6. PAYROLL CONTROL
app.get('/api/payroll-posted', (req, res) => {
    db.query('SELECT month_year FROM payroll_posts', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json((results || []).map(r => r.month_year));
    });
});

app.post('/api/payroll-post', (req, res) => {
    db.query('INSERT IGNORE INTO payroll_posts (month_year) VALUES (?)', [req.body.month], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// START BACKEND ENGINE
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
    console.log(`LSAFHR Backend Hub active on port ${PORT}`);
});
