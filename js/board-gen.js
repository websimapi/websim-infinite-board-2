import { uuidv4, randomRange, SimplexNoise } from './utils.js';

// Configuration
const CHUNK_DEPTH = 80; // World units
const ROW_SPACING = 9;
const BOARD_WIDTH = 10; 
const MIN_NODES_PER_ROW = 2;
const MAX_NODES_PER_ROW = 4;
const MIN_NODE_DISTANCE = 4.0;

// Terrain System
const noise = new SimplexNoise(1337);

export const Terrain = {
    WATER_LEVEL: -0.8,

    // Fractal Brownian Motion for detailed, natural noise
    fbm(x, z, octaves, lacunarity, persistence) {
        let total = 0;
        let frequency = 1;
        let amplitude = 1;
        let maxValue = 0;
        for(let i = 0; i < octaves; i++) {
            total += noise.noise2D(x * frequency, z * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }
        return total;
    },

    getBiome(z) {
        // Biome zones based on Z depth
        const depth = Math.abs(z);
        if (depth < 200) return 'GRASS';
        if (depth < 450) return 'FOREST';
        if (depth < 700) return 'DESERT';
        if (depth < 1000) return 'SNOW';
        return 'ALIEN';
    },

    getHeight(x, z) {
        const biome = this.getBiome(z);

        // Domain Warping for organic terrain flow
        // Using lower frequency for base warp
        const qx = this.fbm(x * 0.004, z * 0.004, 2, 2.0, 0.5);
        const qz = this.fbm(x * 0.004 + 5.2, z * 0.004 + 1.3, 2, 2.0, 0.5);

        const xW = x + qx * 20.0;
        const zW = z + qz * 20.0;

        let y = 0;

        if (biome === 'GRASS') {
            // Rolling hills with detailed overlay
            // Base layer
            y += this.fbm(xW * 0.01, zW * 0.01, 3, 2.0, 0.5) * 8.0; 
            // Detail layer
            y += this.fbm(xW * 0.05, zW * 0.05, 3, 2.0, 0.5) * 1.5;
            
        } else if (biome === 'FOREST') {
            // More variation
            y += this.fbm(xW * 0.015, zW * 0.015, 4, 2.0, 0.5) * 10.0;
            y += this.fbm(xW * 0.1, zW * 0.1, 2, 2.0, 0.5) * 0.5;

        } else if (biome === 'DESERT') {
            // Dunes
            const dune = Math.sin(xW * 0.02 + zW * 0.03 + this.fbm(xW*0.05, zW*0.05, 2, 2, 0.5)) * 6.0;
            y += dune + this.fbm(xW * 0.1, zW * 0.1, 3, 2.0, 0.5) * 0.5;

        } else if (biome === 'SNOW') {
            // Rugged
            const mountains = Math.abs(this.fbm(xW * 0.01, zW * 0.01, 5, 2.0, 0.5));
            y += mountains * 25.0 - 5.0; // Higher peaks
            
        } else {
            // Alien
            y += Math.sin(xW * 0.05) * Math.cos(zW * 0.05) * 8.0;
            y += this.fbm(xW * 0.2, zW * 0.2, 3, 2.0, 0.5) * 2.0;
        }

        // Soften the bottom to ensure nice water beds
        if (y < this.WATER_LEVEL - 5) {
            y = this.WATER_LEVEL - 5 + (y - (this.WATER_LEVEL - 5)) * 0.5;
        }

        return y;
    },

    getSlope(x, z) {
        const delta = 0.5; // Slightly larger delta for smoother slope reading
        const h = this.getHeight(x, z);
        const hx = this.getHeight(x + delta, z);
        const hz = this.getHeight(x, z + delta);
        // Approximate magnitude of gradient
        return Math.sqrt(Math.pow(hx - h, 2) + Math.pow(hz - h, 2));
    },

    getColor(x, z, h, slope) { // Added slope as param to avoid recalc
        const biome = this.getBiome(z);
        // If slope not provided, calc it
        const s = slope !== undefined ? slope : this.getSlope(x, z);
        
        // Detailed texture noise
        const n = noise.noise2D(x*0.5, z*0.5); 
        const nDetail = noise.noise2D(x*2.0, z*2.0); 

        // Helper to hex
        const color = (r, g, b) => ({r, g, b}); 
        
        // Underwater / Seabed
        if (h < this.WATER_LEVEL) {
            // Shore blend handled in visuals, this is base color
            const depth = this.WATER_LEVEL - h;
            // Darker blue/greenish mud
            const dark = Math.max(0.2, 0.8 - depth * 0.15);
            return color(
                (0.4 + n*0.1) * dark, 
                (0.35 + n*0.1) * dark, 
                (0.25 + n*0.1) * dark
            );
        }

        // Beach / Shoreline (Base logic, visual shader does smooth blending too)
        if (h < this.WATER_LEVEL + 1.5 && s < 0.5) {
            return color(0.76 + n*0.05, 0.7 + n*0.05, 0.5 + n*0.05); // Sand
        }

        if (biome === 'GRASS') {
            if (s > 0.8) return color(0.45 + n*0.1, 0.35 + n*0.1, 0.25); // Dirt cliffs
            return color(0.25 + n*0.05, 0.5 + n*0.1, 0.2 + nDetail*0.05); // Grass
        }
        if (biome === 'FOREST') {
             if (s > 0.9) return color(0.3, 0.3, 0.35); // Rock
             return color(0.1 + nDetail*0.05, 0.25 + n*0.1, 0.1 + nDetail*0.05); // Dark Green
        }
        if (biome === 'DESERT') {
            return color(0.85 + n*0.1, 0.75 + n*0.05 + nDetail*0.05, 0.5 + n*0.1); // Sand
        }
        if (biome === 'SNOW') {
            if (h > 8 || s < 0.6) return color(0.95 + nDetail*0.05, 0.95 + nDetail*0.05, 0.98); // Snow
            return color(0.35 + n*0.1, 0.35 + n*0.1, 0.4); // Rock
        }
        // Alien
        return color(0.5 + n*0.4, 0.05 + nDetail*0.1, 0.5 + Math.sin(z)*0.4);
    }
};

export class BoardGenerator {
    /**
     * Generates a chunk of the board.
     * @param {number} chunkIndex 
     * @param {Array} prevRowNodes - Nodes from the end of the previous chunk.
     * @returns {Object} Chunk data.
     */
    generateChunk(chunkIndex, prevRowNodes = []) {
        const nodes = [];
        const edges = [];

        // Z coordinates: We move towards negative Z
        const startZ = -chunkIndex * CHUNK_DEPTH; 

        // Padding allows nodes to spawn away from edges, preventing terrain flattening seams
        const PADDING = 6.0;
        let currentZ = startZ - PADDING;
        const endZ = startZ - CHUNK_DEPTH + PADDING;

        let lastRow = prevRowNodes;

        // Initialize start node if this is the first chunk and empty
        if (chunkIndex === 0 && lastRow.length === 0) {
            const startNode = {
                id: `node_start`,
                x: 0,
                y: Terrain.getHeight(0, 0),
                z: 0,
                color: '#44aaff'
            };
            nodes.push(startNode);
            lastRow = [startNode];
            currentZ = -ROW_SPACING;
        }

        while (currentZ > endZ) {
            const rowNodeCount = Math.floor(randomRange(MIN_NODES_PER_ROW, MAX_NODES_PER_ROW + 1));
            const currentRow = [];

            // Generate nodes for this row with collision detection
            let attempts = 0;
            const maxAttempts = 50;

            while (currentRow.length < rowNodeCount && attempts < maxAttempts) {
                attempts++;
                
                const x = randomRange(-BOARD_WIDTH, BOARD_WIDTH);
                const z = currentZ + randomRange(-0.8, 0.8);

                // Check slope for flat surface
                const slope = Terrain.getSlope(x, z);
                if (slope > 0.8 && attempts < 40) {
                    // Try to find a flatter spot
                    continue;
                }

                let tooClose = false;
                for (const existing of currentRow) {
                    if (Math.hypot(existing.x - x, existing.z - z) < MIN_NODE_DISTANCE) {
                        tooClose = true;
                        break;
                    }
                }

                if (!tooClose) {
                    const node = {
                        id: `c${chunkIndex}_${uuidv4()}`,
                        x: x,
                        y: Terrain.getHeight(x, z), 
                        z: z,
                        color: '#ffffff'
                    };
                    nodes.push(node);
                    currentRow.push(node);
                }
            }

            if (currentRow.length === 0) {
                 const x = randomRange(-BOARD_WIDTH/2, BOARD_WIDTH/2);
                 const z = currentZ;
                 const node = {
                    id: `c${chunkIndex}_${uuidv4()}`,
                    x: x,
                    y: Terrain.getHeight(x, z),
                    z: z,
                    color: '#ffffff'
                };
                nodes.push(node);
                currentRow.push(node);
            }

            // Create connections

            // 1. Ensure every parent connects to at least one child (Branching)
            lastRow.forEach(parent => {
                // Find close children
                const sortedChildren = [...currentRow].sort((a, b) => {
                    const distA = Math.hypot(a.x - parent.x, a.z - parent.z);
                    const distB = Math.hypot(b.x - parent.x, b.z - parent.z);
                    return distA - distB;
                });

                // Connect to 1 to 3 closest children
                const connectionCount = Math.floor(randomRange(1, 3));
                for(let k=0; k<connectionCount && k<sortedChildren.length; k++) {
                    const child = sortedChildren[k];
                    // Prevent extremely long horizontal jumps
                    if (Math.abs(child.x - parent.x) < BOARD_WIDTH * 1.2) {
                        edges.push({ from: parent.id, to: child.id });
                    }
                }
            });

            // 2. Ensure every child has at least one parent (Merging/Reachability)
            currentRow.forEach(child => {
                const hasParent = edges.some(e => e.to === child.id);
                if (!hasParent) {
                    // Find closest parent
                    let closestParent = null;
                    let minDst = Infinity;

                    lastRow.forEach(p => {
                        const d = Math.hypot(p.x - child.x, p.z - child.z);
                        if (d < minDst) {
                            minDst = d;
                            closestParent = p;
                        }
                    });

                    if (closestParent) {
                        edges.push({ from: closestParent.id, to: child.id });
                    }
                }
            });

            lastRow = currentRow;
            currentZ -= ROW_SPACING;
        }

        return {
            index: chunkIndex,
            nodes,
            edges,
            exitNodes: lastRow
        };
    }
}