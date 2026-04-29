export function getRelativeDate(inputDate) {
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);

	// Resetting the time part for accurate comparison
	const input = new Date(inputDate);
	input.setHours(0, 0, 0, 0);
	today.setHours(0, 0, 0, 0);
	yesterday.setHours(0, 0, 0, 0);

	const oneDay = 24 * 60 * 60 * 1000; // milliseconds in one day
	const sevenDays = 7 * oneDay;
	const thirtyDays = 30 * oneDay;
	const diff = today.getTime() - input.getTime();

	if (diff === 0) {
		return 'Today';
	} else if (diff <= oneDay) {
		return 'Yesterday';
	} else if (diff <= sevenDays) {
		return 'Previous 7 days';
	} else if (diff <= thirtyDays) {
		return 'Previous 30 days';
	} else {
		// Formatting the date as "Month"
		return input.toLocaleDateString('en-US', { month: 'long' });
	}
}
