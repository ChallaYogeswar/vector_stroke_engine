const fs = require('fs');
const { DOMParser } = require('xmldom');
const { parse } = require('svg-parser');

class SVGToPoints {
    constructor(svgPath, options = {}) {
        this.svgPath = svgPath;
        this.samplingDensity = options.samplingDensity || 0.5;
        this.layers = [];
    }

    async convert() {
        const svgContent = fs.readFileSync(this.svgPath, 'utf-8');
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgContent, 'image/svg+xml');

        const svg = doc.documentElement;
        const width = parseFloat(svg.getAttribute('width') || 1024);
        const height = parseFloat(svg.getAttribute('height') || 1024);

        this.extractLayers(svg);

        const output = {
            meta: {
                width,
                height,
                totalPoints: this.getTotalPoints(),
                layers: this.layers.length
            },
            layers: this.layers
        };

        return output;
    }

    extractLayers(svg) {
        const groups = svg.getElementsByTagName('g');

        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const layerName = group.getAttribute('id') || `layer_${i}`;
            const paths = group.getElementsByTagName('path');

            const points = [];
            for (let j = 0; j < paths.length; j++) {
                const pathData = paths[j].getAttribute('d');
                const pathPoints = this.parsePath(pathData);
                points.push(...pathPoints);
            }

            const stroke = group.getAttribute('stroke') || '#ffffff';

            this.layers.push({
                name: layerName,
                stroke,
                points
            });
        }
    }

    parsePath(pathData) {
        const points = [];
        const commands = this.tokenizePath(pathData);
        let currentX = 0;
        let currentY = 0;
        let startX = 0;
        let startY = 0;

        for (const cmd of commands) {
            switch (cmd.type) {
                case 'M':
                    currentX = cmd.x;
                    currentY = cmd.y;
                    startX = currentX;
                    startY = currentY;
                    points.push({ x: currentX, y: currentY });
                    break;

                case 'L':
                    const linePoints = this.sampleLine(
                        currentX, currentY,
                        cmd.x, cmd.y
                    );
                    points.push(...linePoints);
                    currentX = cmd.x;
                    currentY = cmd.y;
                    break;

                case 'C':
                    const curvePoints = this.sampleCubicBezier(
                        currentX, currentY,
                        cmd.x1, cmd.y1,
                        cmd.x2, cmd.y2,
                        cmd.x, cmd.y
                    );
                    points.push(...curvePoints);
                    currentX = cmd.x;
                    currentY = cmd.y;
                    break;

                case 'Q':
                    const quadPoints = this.sampleQuadraticBezier(
                        currentX, currentY,
                        cmd.x1, cmd.y1,
                        cmd.x, cmd.y
                    );
                    points.push(...quadPoints);
                    currentX = cmd.x;
                    currentY = cmd.y;
                    break;

                case 'Z':
                    const closePoints = this.sampleLine(
                        currentX, currentY,
                        startX, startY
                    );
                    points.push(...closePoints);
                    currentX = startX;
                    currentY = startY;
                    break;
            }
        }

        return points;
    }

    tokenizePath(pathData) {
        const commands = [];
        const tokens = pathData.match(/[a-zA-Z][^a-zA-Z]*/g);

        tokens?.forEach(token => {
            const type = token[0].toUpperCase();
            const values = token.slice(1).trim().split(/[\s,]+/).map(parseFloat);

            switch (type) {
                case 'M':
                case 'L':
                    commands.push({ type, x: values[0], y: values[1] });
                    break;
                case 'C':
                    commands.push({
                        type,
                        x1: values[0], y1: values[1],
                        x2: values[2], y2: values[3],
                        x: values[4], y: values[5]
                    });
                    break;
                case 'Q':
                    commands.push({
                        type,
                        x1: values[0], y1: values[1],
                        x: values[2], y: values[3]
                    });
                    break;
                case 'Z':
                    commands.push({ type: 'Z' });
                    break;
            }
        });

        return commands;
    }

    sampleLine(x1, y1, x2, y2) {
        const points = [];
        const distance = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const steps = Math.max(2, Math.ceil(distance * this.samplingDensity));

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            points.push({
                x: x1 + (x2 - x1) * t,
                y: y1 + (y2 - y1) * t
            });
        }

        return points;
    }

    sampleCubicBezier(x0, y0, x1, y1, x2, y2, x3, y3) {
        const points = [];
        const steps = Math.ceil(50 * this.samplingDensity);

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const t2 = t * t;
            const t3 = t2 * t;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;

            const x = mt3 * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3 * x3;
            const y = mt3 * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t3 * y3;

            points.push({ x, y });
        }

        return points;
    }

    sampleQuadraticBezier(x0, y0, x1, y1, x2, y2) {
        const points = [];
        const steps = Math.ceil(30 * this.samplingDensity);

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const t2 = t * t;
            const mt = 1 - t;
            const mt2 = mt * mt;

            const x = mt2 * x0 + 2 * mt * t * x1 + t2 * x2;
            const y = mt2 * y0 + 2 * mt * t * y1 + t2 * y2;

            points.push({ x, y });
        }

        return points;
    }

    getTotalPoints() {
        return this.layers.reduce((sum, layer) => sum + layer.points.length, 0);
    }

    saveJSON(outputPath) {
        const json = JSON.stringify(this.data, null, 2);
        fs.writeFileSync(outputPath, json);
        console.log(`[SVGToPoints] Saved to ${outputPath}`);
        console.log(`[SVGToPoints] Total points: ${this.getTotalPoints()}`);
    }
}

async function main() {
    const converter = new SVGToPoints('input.svg', {
        samplingDensity: 0.5
    });

    const data = await converter.convert();

    fs.writeFileSync('stroke-data.json', JSON.stringify(data, null, 2));

    console.log('[SVGToPoints] Conversion complete');
    console.log(`[SVGToPoints] Layers: ${data.meta.layers}`);
    console.log(`[SVGToPoints] Points: ${data.meta.totalPoints}`);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { SVGToPoints };
