export function parseXML(xmlString) {
	// Regular expression to match the opening tag
	const openingTagRegex = /<([^\s>]+)([^>]*)>/;
	const match = xmlString.match(openingTagRegex);

	if (!match) {
		throw new Error("Invalid XML: No opening tag found");
	}

	// Extract element name (first capture group)
	const element = match[1];

	// Extract attributes string (second capture group) and trim whitespace
	const attributesString = match[2].trim();

	// Parse attributes
	const attributes = {};

	if (attributesString) {
		// Pattern to match attribute name and optional value
		// Handles: name="value", name='value', name=value, and standalone attributes
		const pattern = /([^\s=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

		let attrMatch;
		while ((attrMatch = pattern.exec(attributesString)) !== null) {
			const [, name, doubleQuoted, singleQuoted, unquoted] = attrMatch;

			// Determine the value - use the first defined value or true for standalone attributes
			const value = doubleQuoted !== undefined ? doubleQuoted :
				singleQuoted !== undefined ? singleQuoted :
					unquoted !== undefined ? unquoted : true;

			attributes[name] = value;
		}
	}

	// Extract content between opening and closing tags
	const fullOpeningTag = xmlString.match(new RegExp(`<${element}[^>]*>`))[0];
	const closingTag = `</${element}>`;
	const startPos = xmlString.indexOf(fullOpeningTag) + fullOpeningTag.length;
	const endPos = xmlString.lastIndexOf(closingTag);

	let content = "";
	if (startPos > 0 && endPos > startPos) {
		content = xmlString.substring(startPos, endPos).trim();
	}

	return {
		element,
		attributes,
		content
	};
}