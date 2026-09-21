// One-off dev helper: create role accounts for the Blue Moon branch (BRANCH_ID=3)
// so restoApp-Bluemoon has something to log in with, mirroring the
// waiter001 / cashier / kitchen / table001 accounts used by Daraejung (BRANCH_ID=1).
//
// Usage:  node scripts/createBluemoonAccounts.js [password]
// Default password: 123

const path = require('path');
const argon2 = require('argon2');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env.local'), override: true });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });

const PASSWORD = process.argv[2] || '123';
const BRANCH_ID = 3; // Blue Moon

// permissions: 14=Waiter, 15=Cashier, 16=Kitchen, 2=Menu/Table tablet
const ACCOUNTS = [
	{ username: 'bm_waiter', firstname: 'Bluemoon', lastname: 'Waiter', permissions: 14, table_id: null },
	{ username: 'bm_cashier', firstname: 'Bluemoon', lastname: 'Cashier', permissions: 15, table_id: null },
	{ username: 'bm_kitchen', firstname: 'Bluemoon', lastname: 'Kitchen', permissions: 16, table_id: null },
];

(async () => {
	const conn = await mysql.createConnection({
		host: process.env.DB_HOST,
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database: process.env.DB_NAME,
		port: process.env.DB_PORT,
	});

	// Link the "menu" tablet account to an actual Blue Moon table if one exists.
	const [tables] = await conn.execute(
		'SELECT IDNo, TABLE_NUMBER FROM restaurant_tables WHERE BRANCH_ID = ? AND ACTIVE = 1 ORDER BY IDNo LIMIT 1',
		[BRANCH_ID]
	);
	if (tables.length) {
		ACCOUNTS.push({
			username: 'bm_table01',
			firstname: `Table ${tables[0].TABLE_NUMBER}`,
			lastname: 'Bluemoon',
			permissions: 2,
			table_id: tables[0].IDNo,
		});
	}

	for (const acc of ACCOUNTS) {
		const [existing] = await conn.execute('SELECT IDNo FROM user_info WHERE USERNAME = ?', [acc.username]);
		const hash = await argon2.hash(PASSWORD);
		if (existing.length) {
			await conn.execute(
				"UPDATE user_info SET PASSWORD = ?, SALT = '', PERMISSIONS = ?, TABLE_ID = ?, BRANCH_ID = ?, ACTIVE = 1 WHERE USERNAME = ?",
				[hash, acc.permissions, acc.table_id, BRANCH_ID, acc.username]
			);
			console.log(`${acc.username}: updated (IDNo=${existing[0].IDNo})`);
		} else {
			const [res] = await conn.execute(
				`INSERT INTO user_info
					(FIRSTNAME, LASTNAME, USERNAME, PASSWORD, SALT, PERMISSIONS, TABLE_ID, LAST_LOGIN, ENCODED_DT, ACTIVE, BRANCH_ID)
				 VALUES (?, ?, ?, ?, '', ?, ?, NOW(), NOW(), 1, ?)`,
				[acc.firstname, acc.lastname, acc.username, hash, acc.permissions, acc.table_id, BRANCH_ID]
			);
			console.log(`${acc.username}: created (IDNo=${res.insertId})`);
		}
	}

	await conn.end();
	console.log(`\nDone. Password for all Bluemoon accounts: ${PASSWORD}`);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
