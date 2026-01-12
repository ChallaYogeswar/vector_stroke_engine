export class DataLoader {
    constructor() {
        this.data = null;
        this.binaryMode = false;
    }

    async loadJSON(url) {
        try {
            const response = await fetch(url);
            this.data = await response.json();
            this.normalizeCoordinates();
            console.log('[DataLoader] JSON loaded:', this.data.meta);
            return this.data;
        } catch (error) {
            console.error('[DataLoader] Failed to load JSON:', error);
            throw error;
        }
    }

    async loadBinary(url) {
        try {
            const response = await fetch(url);
            const buffer = await response.arrayBuffer();
            this.data = this.parseBinary(buffer);
            console.log('[DataLoader] Binary loaded:', this.data.meta);
            this.binaryMode = true;
            return this.data;
        } catch (error) {
            console.error('[DataLoader] Failed to load binary:', error);
            throw error;
        }
    }

    parseBinary(buffer) {
        const view = new DataView(buffer);
        let offset = 0;

        const metaLength = view.getUint32(offset, true);
        offset += 4;

        const metaBytes = new Uint8Array(buffer, offset, metaLength);
        const metaString = new TextDecoder().decode(metaBytes);
        const meta = JSON.parse(metaString);
        offset += metaLength;

        const layers = [];
        for (let i = 0; i < meta.layers; i++) {
            const nameLength = view.getUint16(offset, true);
            offset += 2;

            const nameBytes = new Uint8Array(buffer, offset, nameLength);
            const name = new TextDecoder().decode(nameBytes);
            offset += nameLength;

            const colorLength = view.getUint8(offset);
            offset += 1;

            const colorBytes = new Uint8Array(buffer, offset, colorLength);
            const stroke = new TextDecoder().decode(colorBytes);
            offset += colorLength;

            const pointCount = view.getUint32(offset, true);
            offset += 4;

            const points = new Float32Array(buffer, offset, pointCount * 2);
            offset += pointCount * 2 * 4;

            layers.push({
                name,
                stroke,
                points: Array.from({ length: pointCount }, (_, i) => ({
                    x: points[i * 2],
                    y: points[i * 2 + 1]
                }))
            });
        }

        return { meta, layers };
    }

    normalizeCoordinates() {
        if (!this.data) return;

        const { width, height } = this.data.meta;

        this.data.layers.forEach(layer => {
            layer.points = layer.points.map(p => ({
                x: p.x / width,
                y: p.y / height
            }));
        });
    }

    validate() {
        if (!this.data) return false;
        if (!this.data.meta) return false;
        if (!this.data.layers || this.data.layers.length === 0) return false;

        return this.data.layers.every(layer =>
            layer.points && layer.points.length > 0
        );
    }

    getTotalPoints() {
        if (!this.data) return 0;
        return this.data.layers.reduce((sum, layer) => sum + layer.points.length, 0);
    }

    getLayer(index) {
        if (!this.data || index >= this.data.layers.length) return null;
        return this.data.layers[index];
    }
}
