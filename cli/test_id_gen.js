// Test the toKebabCase function
function toKebabCase(text) {
  // Replace spaces and underscores with hyphens
  let result = text.replace(/[\s_]+/g, '-');

  // Insert hyphen before capital letters (for camelCase/PascalCase)
  result = result.replace(/([a-z])([A-Z])/g, '$1-$2');

  // Convert to lowercase
  result = result.toLowerCase();

  // Remove multiple consecutive hyphens
  result = result.replace(/-+/g, '-');

  // Remove leading/trailing hyphens
  result = result.replace(/^-+|-+$/g, '');

  return result;
}

const testCases = [
  'Test Goal (Priority: Critical)',
  'Test Goal',
  'Improve System',
  'Enhance Security',
];

testCases.forEach(tc => {
  const kebab = toKebabCase(tc);
  console.log(`"${tc}" -> "${kebab}"`);
});
