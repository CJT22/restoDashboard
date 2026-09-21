// ============================================
// UPDATE CATEGORIES TO KOREAN NAMES
// ============================================
// Script to update category names from English to Korean
// based on folder structure in "menu food/menu food"
// ============================================

const pool = require('../config/db');

// Mapping of English category names to Korean folder names
const categoryMapping = {
	'Recommended Menu': '추천메뉴',
	'Recommended Meal': '추천식사',
	'Lunch Special': '점심특선',
	'Set Menu': '세트메뉴',
	'BBQ': '바비큐',
	'Seafood': '해산물',
	'Grilled & Fried Dishes': '구이전튀김',
	'Aged Kimchi Specialty Dishes': '묵은지일품요리',
	'Meal Types': '식사류',
	'Noodle Dishes': '면류',
	'Lunchbox Add-on Menu': '도시락추가메뉴',
	'Alcoholic Beverages': '주류음료'
};

async function updateCategoriesToKorean() {
	try {
		console.log('Starting category update to Korean names...\n');

		// Get all active categories
		const [categories] = await pool.execute(
			'SELECT IDNo, CAT_NAME FROM categories WHERE ACTIVE = 1'
		);

		console.log(`Found ${categories.length} active categories\n`);

		let updatedCount = 0;
		let notFoundCount = 0;

		for (const category of categories) {
			const englishName = category.CAT_NAME.trim();
			const koreanName = categoryMapping[englishName];

			if (koreanName) {
				// Update category name to Korean
				await pool.execute(
					'UPDATE categories SET CAT_NAME = ? WHERE IDNo = ?',
					[koreanName, category.IDNo]
				);
				console.log(`✓ Updated: "${englishName}" → "${koreanName}"`);
				updatedCount++;
			} else {
				console.log(`✗ Not found in mapping: "${englishName}" (ID: ${category.IDNo})`);
				notFoundCount++;
			}
		}

		console.log(`\n=== Summary ===`);
		console.log(`Updated: ${updatedCount} categories`);
		console.log(`Not found in mapping: ${notFoundCount} categories`);
		console.log('\nCategory update completed!');

		process.exit(0);
	} catch (error) {
		console.error('Error updating categories:', error);
		process.exit(1);
	}
}

// Run the script
updateCategoriesToKorean();

