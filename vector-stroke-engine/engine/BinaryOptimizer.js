export class BinaryOptimizer {
    static jsonToBinary(jsonData) {
        const metaString = JSON.stringify(jsonData.meta);
        const metaBytes = new TextEncoder().encode(metaString);

        let totalSize = 4 + metaBytes.length;

        const layerData = [];
        jsonData.layers.forEach(layer => {
            const nameBytes = new TextEncoder().encode(layer.name);
            const colorBytes = new TextEncoder().encode(layer.stroke);
            const pointCount = layer.points.length;

            layerData.push({
                nameBytes,
                colorBytes,
                pointCount,
                points: layer.points
            });

            totalSize += 2 + nameBytes.length;
            totalSize += 1 + colorBytes.length;
            totalSize += 4;
            totalSize += pointCount * 2 * 4;
        });

        const buffer = new ArrayBuffer(totalSize);
        const view = new DataView(buffer);
        let offset = 0;

        view.setUint32(offset, metaBytes.length, true);
        offset += 4;

        new Uint8Array(buffer, offset, metaBytes.length).set(metaBytes);
        offset += metaBytes.length;

        layerData.forEach(layer => {
            view.setUint16(offset, layer.nameBytes.length, true);
            offset += 2;

            new Uint8Array(buffer, offset, layer.nameBytes.length).set(layer.nameBytes);
            offset += layer.nameBytes.length;

            view.setUint8(offset, layer.colorBytes.length);
            offset += 1;

            new Uint8Array(buffer, offset, layer.colorBytes.length).set(layer.colorBytes);
            offset += layer.colorBytes.length;

            view.setUint32(offset, layer.pointCount, true);
            offset += 4;

            const pointsArray = new Float32Array(buffer, offset, layer.pointCount * 2);
            layer.points.forEach((point, i) => {
                pointsArray[i * 2] = point.x;
                pointsArray[i * 2 + 1] = point.y;
            });
            offset += layer.pointCount * 2 * 4;
        });

        return buffer;
    }

    static downloadBinary(buffer, filename = 'stroke-data.bin') {
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    static async convertJSONFileToBinary(jsonUrl) {
        const response = await fetch(jsonUrl);
        const jsonData = await response.json();
        const buffer = BinaryOptimizer.jsonToBinary(jsonData);

        const originalSize = JSON.stringify(jsonData).length;
        const binarySize = buffer.byteLength;
        const reduction = ((1 - binarySize / originalSize) * 100).toFixed(1);

        console.log(`[BinaryOptimizer] Original: ${originalSize} bytes`);
        console.log(`[BinaryOptimizer] Binary: ${binarySize} bytes`);
        console.log(`[BinaryOptimizer] Reduction: ${reduction}%`);

        return buffer;
    }
}
