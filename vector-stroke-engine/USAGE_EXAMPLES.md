# Vector Stroke Rendering Engine - Usage Examples

## Convert SVG to Points
```bash
node tools/svg-to-points.js input.svg stroke-data.json
```

## Convert to Binary
```bash
node tools/binary-converter.js stroke-data.json stroke-data.bin
```

## Generate Procedural Handwriting
```javascript
import { HandwritingGenerator } from './procedural/handwriting-generator.js';

const generator = new HandwritingGenerator();
const data = generator.generateText('Hello World', 100);
```

## Use AI Path Generator
```javascript
import { AIPathFeeder } from './procedural/ai-path-feeder.js';

const ai = new AIPathFeeder();
const data = await ai.generateFromPrompt('portrait of Einstein', {
    style: 'sketch',
    complexity: 'high',
    pointDensity: 80000
});
```

## Export Video
```javascript
import { VideoExporter } from './tools/video-exporter.js';

const canvas = document.getElementById('mainCanvas');
const exporter = new VideoExporter(canvas, { fps: 60, duration: 15 });
await exporter.startRecording();
// ... animate
exporter.stopRecording();
```

## Generate Procedural Paths
```javascript
import { PathGenerator } from './tools/path-generator.js';

// Generate a circle
const circle = PathGenerator.generateCircle(0.5, 0.5, 0.3, 100);

// Generate a spiral
const spiral = PathGenerator.generateSpiral(0.5, 0.5, 3, 500);

// Apply noise to existing points
const noisyPoints = PathGenerator.applyNoise(circle, 0.01);

// Smooth existing points
const smoothPoints = PathGenerator.smooth(circle, 2);
```

## Inject Noise into Stroke Data
```javascript
import { NoiseInjector } from './procedural/noise-injector.js';

const injector = new NoiseInjector();

// Add uniform noise
const uniformNoise = injector.injectUniform(points, 0.001);

// Add Perlin noise
const perlinNoise = injector.injectPerlin(points, 0.1, 0.002);

// Add directional noise
const directionalNoise = injector.injectDirectional(points, 'vertical', 0.001);

// Add temporal noise (animated)
const temporalNoise = injector.injectTemporal(points, 0.1, 0.001);
```

## Binary Data Optimization
```javascript
import { BinaryOptimizer } from './engine/BinaryOptimizer.js';

// Convert JSON to binary
const buffer = BinaryOptimizer.jsonToBinary(jsonData);

// Download binary file
BinaryOptimizer.downloadBinary(buffer, 'stroke-data.bin');

// Convert JSON file to binary
await BinaryOptimizer.convertJSONFileToBinary('stroke-data.json');
```

## Custom Data Loading
```javascript
import { DataLoader } from './engine/DataLoader.js';

const loader = new DataLoader();

// Load JSON data
const jsonData = await loader.loadJSON('data/stroke-data.json');

// Load binary data
const binaryData = await loader.loadBinary('data/stroke-data.bin');

// Validate data
if (loader.validate()) {
    console.log('Data is valid');
    console.log('Total points:', loader.getTotalPoints());
}

// Get specific layer
const layer = loader.getLayer(0);
```

## Custom Rendering
```javascript
import { Renderer } from './engine/Renderer.js';
import { RendererWebGL } from './engine/RendererWebGL.js';

const canvas = document.getElementById('myCanvas');
const renderer = new Renderer(canvas);

// Clear canvas
renderer.clear();

// Set drawing style
renderer.setStyle('#ff0000', 2);

// Draw points
renderer.drawPoints(layer.points, 0, 100, '#ff0000', 2, true);

// Resize renderer
renderer.resize();

// Set noise level
renderer.setNoise(0.005);
```

## Timeline Control
```javascript
import { Timeline } from './engine/Timeline.js';

const timeline = new Timeline(totalPoints);

// Start playback
timeline.play();

// Pause playback
timeline.pause();

// Reset timeline
timeline.reset();

// Set playback speed
timeline.setSpeed(2.0);

// Check status
if (timeline.isPlaying()) {
    console.log('Progress:', timeline.getProgress());
    console.log('Current index:', timeline.getCurrentIndex());
}
```

## Telemetry Monitoring
```javascript
import { Telemetry } from './engine/Telemetry.js';

const telemetry = new Telemetry();

// Update telemetry (call this every frame)
telemetry.update('layer_name', currentPoint, totalPoints, speed);

// Reset telemetry
telemetry.reset();
```

## Controller Integration
```javascript
import { Controller } from './engine/Controller.js';

// Initialize controller (this sets up everything)
const controller = new Controller();

// The controller automatically:
// - Loads data from 'data/stroke-data.json'
// - Sets up renderers (Canvas and WebGL)
// - Initializes controls and telemetry
// - Starts the animation loop
```

## Development Server
```bash
npm install
npm run dev
```

## Testing Pipeline
```bash
npm run test
```

## API Reference

### DataLoader
- `loadJSON(url)` - Load JSON stroke data
- `loadBinary(url)` - Load binary stroke data
- `validate()` - Validate loaded data
- `getTotalPoints()` - Get total number of points
- `getLayer(index)` - Get specific layer

### Timeline
- `play()` - Start animation
- `pause()` - Pause animation
- `reset()` - Reset to beginning
- `setSpeed(multiplier)` - Set playback speed
- `getProgress()` - Get completion percentage
- `isComplete()` - Check if animation finished

### Renderer
- `clear()` - Clear canvas
- `setStyle(color, width)` - Set drawing style
- `drawPoints(points, start, end, color, width, noise)` - Draw point range
- `resize()` - Handle canvas resize
- `setNoise(amount)` - Set noise level

### Controller
- Constructor initializes everything automatically
- Manages data loading, rendering, controls, and animation

### BinaryOptimizer
- `jsonToBinary(jsonData)` - Convert JSON to binary buffer
- `downloadBinary(buffer, filename)` - Download binary file
- `convertJSONFileToBinary(jsonUrl)` - Convert JSON file to binary

### PathGenerator (Static Methods)
- `generateCircle(cx, cy, radius, points)` - Generate circle path
- `generateSpiral(cx, cy, turns, points)` - Generate spiral path
- `generateWave(startX, startY, width, amplitude, frequency, points)` - Generate wave path
- `generateLissajous(cx, cy, a, b, delta, scale, points)` - Generate Lissajous curve
- `applyNoise(points, amount)` - Add noise to points
- `smooth(points, iterations)` - Smooth points

### NoiseInjector
- `injectUniform(points, amount)` - Add uniform random noise
- `injectPerlin(points, scale, amplitude)` - Add Perlin noise
- `injectDirectional(points, direction, amount)` - Add directional noise
- `injectTemporal(points, frequency, amplitude)` - Add animated noise
- `injectPressureSensitive(points, pressureMap)` - Add pressure-based noise

### HandwritingGenerator
- `generateText(text, startX)` - Generate handwritten text
- `generateCharacter(char, x, y)` - Generate single character
- `generateSignature(name, startX, startY)` - Generate signature

### AIPathFeeder
- `generateFromPrompt(prompt, options)` - Generate paths from AI prompt
- `enhanceExistingData(data, enhancement)` - Enhance existing stroke data
- `processAIResponse(data)` - Process AI API response

### VideoExporter
- `startRecording()` - Start video recording
- `stopRecording()` - Stop recording and download
- `exportFrames(controller, callback)` - Export individual frames
