import { PathGenerator } from '../tools/path-generator.js';

export class HandwritingGenerator {
    constructor() {
        this.baselineY = 300;
        this.xHeight = 40;
        this.ascenderHeight = 60;
        this.descenderHeight = 60;
        this.letterSpacing = 50;
        this.wordSpacing = 100;
    }

    generateText(text, startX = 100) {
        const layers = [];
        let currentX = startX;

        const words = text.split(' ');

        words.forEach((word, wordIndex) => {
            const wordPoints = [];

            for (let i = 0; i < word.length; i++) {
                const char = word[i];
                const charPoints = this.generateCharacter(char, currentX, this.baselineY);
                wordPoints.push(...charPoints);
                currentX += this.letterSpacing;
            }

            layers.push({
                name: `word_${wordIndex}`,
                stroke: '#ffffff',
                points: PathGenerator.applyNoise(wordPoints, 0.5)
            });

            currentX += this.wordSpacing;
        });

        return {
            meta: {
                width: currentX,
                height: 600,
                totalPoints: layers.reduce((sum, l) => sum + l.points.length, 0),
                layers: layers.length
            },
            layers
        };
    }

    generateCharacter(char, x, y) {
        const generators = {
            'a': () => this.generateA(x, y),
            'b': () => this.generateB(x, y),
            'c': () => this.generateC(x, y),
            'e': () => this.generateE(x, y),
            'l': () => this.generateL(x, y),
            'o': () => this.generateO(x, y),
            'h': () => this.generateH(x, y)
        };

        return generators[char.toLowerCase()]?.() || this.generateDefault(x, y);
    }

    generateA(x, y) {
        return [
            ...PathGenerator.generateCircle(x + 15, y - 20, 15, 30),
            { x: x + 30, y: y - 35 },
            { x: x + 30, y: y }
        ];
    }

    generateB(x, y) {
        return [
            { x, y: y - this.ascenderHeight },
            { x, y },
            ...PathGenerator.generateCircle(x + 15, y - 20, 15, 30)
        ];
    }

    generateC(x, y) {
        const points = PathGenerator.generateCircle(x + 15, y - 20, 15, 40);
        return points.slice(10, 35);
    }

    generateE(x, y) {
        return [
            ...PathGenerator.generateCircle(x + 15, y - 20, 15, 40),
            { x: x + 10, y: y - 20 }
        ];
    }

    generateL(x, y) {
        return [
            { x, y: y - this.ascenderHeight },
            { x, y }
        ];
    }

    generateO(x, y) {
        return PathGenerator.generateCircle(x + 15, y - 20, 15, 40);
    }

    generateH(x, y) {
        return [
            { x, y: y - this.ascenderHeight },
            { x, y },
            { x, y: y - 20 },
            { x: x + 20, y: y - 20 },
            { x: x + 20, y: y - 35 },
            { x: x + 20, y: y }
        ];
    }

    generateDefault(x, y) {
        return [
            { x, y: y - this.xHeight },
            { x, y }
        ];
    }

    generateSignature(name, startX, startY) {
        const points = [];
        let x = startX;

        for (let i = 0; i < name.length; i++) {
            const char = name[i];
            const charPoints = this.generateCharacter(char, x, startY);
            points.push(...charPoints);
            x += this.letterSpacing * 1.5;
        }

        const signature = PathGenerator.smooth(points, 3);
        const withNoise = PathGenerator.applyNoise(signature, 1.5);
        
        const flourish = PathGenerator.generateSpiral(x, startY, 1.5, 50);
        
        return [...withNoise, ...flourish];
    }
}
