/**
 * Sargable Asia/Manila (+08:00) inclusive day-range predicates.
 * CONVERT_TZ / DATE_ADD are applied to *constants* so MySQL can use indexes
 * on the raw datetime column (unlike DATE(CONVERT_TZ(column, ...))).
 */

/**
 * @param {string} column e.g. 'b.ENCODED_DT' or 'o.ENCODED_DT'
 * @param {string|null|undefined} startDate YYYY-MM-DD
 * @param {string|null|undefined} endDate YYYY-MM-DD
 * @returns {{ sql: string, params: string[] }}
 */
function phLocalDayRangeFilter(column, startDate, endDate) {
	const start = startDate != null ? String(startDate).slice(0, 10) : '';
	const end = endDate != null ? String(endDate).slice(0, 10) : '';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
		return { sql: '', params: [] };
	}
	const sql = ` AND ${column} >= COALESCE(
		CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+08:00', @@session.time_zone),
		DATE_SUB(CONCAT(?, ' 00:00:00'), INTERVAL 8 HOUR)
	) AND ${column} < COALESCE(
		CONVERT_TZ(DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY), '+08:00', @@session.time_zone),
		DATE_SUB(DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY), INTERVAL 8 HOUR)
	)`;
	return { sql, params: [start, start, end, end] };
}

module.exports = { phLocalDayRangeFilter };
