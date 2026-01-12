const fs = require('fs');
const { BinaryOptimizer } = require('../engine/BinaryOptimizer.js');

async function convertToBinary(jsonPath, outputPath = 'stroke-data.bin') {
    const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
    const jsonData = JSON.parse(jsonContent);

    const buffer = BinaryOptimizer.jsonToBinary(jsonData);

    fs.writeFileSync(outputPath, Buffer.from(buffer));

    const originalSize = jsonContent.length;
    const binarySize = buffer.byteLength;
    const reduction = ((1 - binarySize / originalSize) * 100).toFixed(1);

    console.log(`[BinaryConverter] Original JSON: ${originalSize} bytes`);
    console.log(`[BinaryConverter] Binary output: ${binarySize} bytes`);
    console.log(`[BinaryConverter] Size reduction: ${reduction}%`);
    console.log(`[BinaryConverter] Saved to: ${outputPath}`);
}

if (require.main === module) {
    const jsonPath = process.argv[2] || 'stroke-data.json';
    const outputPath = process.argv[3] || 'stroke-data.bin';

    convertToBinary(jsonPath, outputPath).catch(console.error);
}

module.exports = { convertToBinary };
