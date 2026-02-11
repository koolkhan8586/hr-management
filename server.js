/**
 * ==============================================================================
 * LSAF-HR MANAGEMENT SYSTEM - ROBUST BACKEND ENGINE (v10.2)
 * ==============================================================================
 * DESCRIPTION:
 * This server handles complex employee lifecycles, geofenced attendance,
 * 11-column payroll matrix, and a relational loan/leave approval system.
 * * FIXES INCLUDED:
 * 1. Resolved 500 error on /api/loans by mapping employeeId/employee_id.
 * 2. Automated schema verification (adds missing columns automatically).
 * 3. Enhanced error logging for database transactions.
 * ==============================================================================
 */

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

// MIDDLEWARE
app.use(cors());
app.use(express.json());

// DATABASE CONNECTION POOL
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', 
    database: process.env.DB_NAME || 'hr_management',
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0
});

/**
 * --- AUTOMATED DATABASE MIGRATIONS ---
 * Ensures the MySQL schema matches the requirements of the v10.x frontend.
 */
const runMigrations = () => {
    console.log("LSAFHR: Checking Matrix Schema...");

    // 1. Employee Table - Adding missing Matrix columns
    const employeeColumns = [
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

    employeeColumns.forEach(col => {
        db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS ${col}`, (err) => {
            if (err && err.errno !== 1060) console.error("Migration Error:", err.message);
        });
    });

    // 2. Attendance Table - Adding Geolocation
    const attendanceColumns = [
        "latitude DECIMAL(10,8)",
        "longitude DECIMAL(11,8)"
    ];

    attendanceColumns.forEach(col => {
        db.query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS ${col}`, (err) => {
            if (err && err.errno !== 1060) console.error("Migration Error (Geo):", err.message);
        });
    });

    // 3. Ensuring Relational Tables Exist
    const tables = [
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

    tables.forEach(sql => {
        db.query(sql, (err) => {
            if (err) console.error("Table Migration Error:", err.message);
        });
    });

    console.log("LSAFHR: Matrix Hub Database Ready.");
};

runMigrations();

/**
 * --- API ENDPOINTS ---
 */

// 1. STAFF HUB
app.get('/api/employees', (req, res) => {
    db.query('SELECT * FROM employees ORDER BY id ASC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/employees', (req, res) => {
    db.query('INSERT INTO employees SET ?', req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
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

// 2. ATTENDANCE HUB
app.post('/api/attendance', (req, res) => {
    const { employee_id, type, date_str, time_str, latitude, longitude } = req.body;
    const sql = 'INSERT INTO attendance (employee_id, type, date_str, time_str, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(sql, [employee_id, type, date_str, time_str, latitude, longitude], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/attendance/:id', (req, res) => {
    db.query('SELECT * FROM attendance WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 3. LOANS HUB (Robust Mapping to fix 500 error)
app.post('/api/loans', (req, res) => {
    // Map both potential naming conventions from frontend
    const empId = req.body.employee_id || req.body.employeeId;
    const { amount, reason } = req.body;

    if (!empId) return res.status(400).json({ error: "Missing identity ID" });

    const sql = 'INSERT INTO loans (employee_id, amount, reason, status) VALUES (?, ?, ?, ?)';
    db.query(sql, [empId, amount, reason, 'Pending'], (err) => {
        if (err) {
            console.error("SQL Error in Loans:", err);
            return res.status(500).json({ error: err.message });
        }
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
    db.query('UPDATE loans SET status = ? WHERE id = ?', [req.body.status, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 4. LEAVES HUB
app.post('/api/leaves', (req, res) => {
    const empId = req.body.employee_id || req.body.employeeId;
    const { type, startDate, days, reason } = req.body;
    const sql = 'INSERT INTO leaves (employee_id, leave_type, start_date, days, reason) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [empId, type, startDate, days, reason], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/leaves/:id', (req, res) => {
    db.query('SELECT * FROM leaves WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
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
        if (results.length === 0) return res.status(404).send();
        const leave = results[0];
        db.query('UPDATE leaves SET status = ? WHERE id = ?', [status, req.params.id], (err) => {
            // Auto-deduct from balance on approval
            if (status === 'Approved') {
                const column = (leave.leave_type === 'Annual Leave') ? 'leave_annual' : 'leave_casual';
                db.query(`UPDATE employees SET \${column} = \${column} - ? WHERE id = ?`, [leave.days, leave.employee_id]);
            }
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

app.delete('/api/payroll-post/:month', (req, res) => {
    db.query('DELETE FROM payroll_posts WHERE month_year = ?', [req.params.month], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// START ENGINE
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
    console.log(`LSAFHR Engine active on port \${PORT}`);
});
