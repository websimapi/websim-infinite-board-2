import * as THREE from 'three';
import { Terrain } from './board-gen.js';
import { lerp } from './utils.js';

export class TerrainVisuals {
    constructor(assets) {
        this.assets = assets;
    }

    // Helper to calculate raw height with path modifications
    getRawHeightWithPaths(x, z, pathSegments, nodes) {
        // Base Terrain Height (Procedural)
        let h = Terrain.getHeight(x, z);
        let finalH = h;
        let maxFlattenWeight = 0;

        // Path Flattening
        if (pathSegments) {
            for (const seg of pathSegments) {
                // Bounds check optimization
                const minX = Math.min(seg.sx, seg.ex) - 6;
                const maxX = Math.max(seg.sx, seg.ex) + 6;
                const minZ = Math.min(seg.sz, seg.ez) - 6;
                const maxZ = Math.max(seg.sz, seg.ez) + 6;
                
                if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
                if (seg.lenSq < 0.001) continue;

                const t = ((x - seg.sx) * (seg.ex - seg.sx) + (z - seg.sz) * (seg.ez - seg.sz)) / seg.lenSq;
                const clampedT = Math.max(0, Math.min(1, t));

                const projX = seg.sx + clampedT * (seg.ex - seg.sx);
                const projZ = seg.sz + clampedT * (seg.ez - seg.sz);
                const distSq = (x - projX)**2 + (z - projZ)**2;

                const roadWidth = 2.0;
                const blendWidth = 5.0;

                if (distSq < blendWidth * blendWidth) {
                    const dist = Math.sqrt(distSq);
                    let w = 0;
                    if (dist < roadWidth) {
                        w = 1.0;
                    } else {
                        // Smooth falloff
                        const v = (dist - roadWidth) / (blendWidth - roadWidth);
                        w = 1.0 - (v * v * (3 - 2 * v));
                    }

                    if (w > maxFlattenWeight) {
                        maxFlattenWeight = w;
                        const targetFlattenHeight = lerp(seg.sy, seg.ey, clampedT);
                        finalH = lerp(finalH, targetFlattenHeight, w);
                    }
                }
            }
        }

        // Node Flattening
        if (nodes) {
            for (const node of nodes) {
                if (Math.abs(node.x - x) > 8 || Math.abs(node.z - z) > 8) continue;
                const dist = Math.hypot(x - node.x, z - node.z);
                const inner = 2.5;
                const outer = 6.0;

                if (dist < outer) {
                    let w = 0;
                    if (dist < inner) {
                        w = 1.0;
                    } else {
                        const v = (dist - inner) / (outer - inner);
                        w = 1.0 - (v * v * (3 - 2 * v));
                    }

                    if (w >= maxFlattenWeight) {
                        maxFlattenWeight = w;
                        finalH = lerp(finalH, node.y, w);
                    }
                }
            }
        }

        return { y: finalH, weight: maxFlattenWeight };
    }

    generateChunkVisuals(chunkData, nextChunkData) {
        const group = new THREE.Group();

        // Combined mesh parameters
        const width = 180; // Covers -90 to +90
        const depth = 80;
        const widthSegments = 160;
        const depthSegments = 70;
        
        // World coordinates
        const zStart = -chunkData.index * depth;
        // Center of the plane geometry
        const zCenter = zStart - depth / 2;

        // 1. Prepare Path Segments
        const pathSegments = [];
        const processEdge = (edge, nodesSource, otherNodesSource) => {
            // Find start/end nodes... (simplified for brevity, assumes logic similar to previous)
            let startNode = nodesSource.find(n => n.id === edge.from);
            // Check prev chunk nodes if not found (passed in chunkData.nodes usually contains them if passed correctly, otherwise we skip)
            if (!startNode) return; // Simplified: assumes internal or forward edges mostly
            
            let endNode = nodesSource.find(n => n.id === edge.to);
            if (!endNode && otherNodesSource) endNode = otherNodesSource.find(n => n.id === edge.to);

            if (startNode && endNode) {
                pathSegments.push({
                    sx: startNode.x, sy: startNode.y, sz: startNode.z,
                    ex: endNode.x, ey: endNode.y, ez: endNode.z,
                    lenSq: (endNode.x - startNode.x)**2 + (endNode.z - startNode.z)**2
                });
            }
        };
        chunkData.edges.forEach(e => processEdge(e, chunkData.nodes));
        if (nextChunkData) nextChunkData.edges.forEach(e => processEdge(e, chunkData.nodes, nextChunkData.nodes));

        // 2. Generate Heightmap with Padding for Smoothing and Normals
        // We need padding of 1 on each side.
        const gridW = widthSegments + 1;
        const gridD = depthSegments + 1;
        const rawW = gridW + 2; // +1 padding each side
        const rawD = gridD + 2; 

        const rawHeights = new Float32Array(rawW * rawD);
        const pathWeights = new Float32Array(rawW * rawD);

        // Geometry origin (top-left of the chunk in world space)
        const originX = -width / 2;
        const originZ = zStart;

        const cellW = width / widthSegments;
        const cellD = depth / depthSegments; // depth is positive direction in loop, but Z is negative
        
        // Loop including padding
        for (let j = -1; j <= gridD; j++) {
            for (let i = -1; i <= gridW; i++) {
                const x = originX + i * cellW;
                const z = originZ - j * cellD; // Moving -Z
                
                const res = this.getRawHeightWithPaths(x, z, pathSegments, chunkData.nodes);
                
                const idx = (j + 1) * rawW + (i + 1);
                rawHeights[idx] = res.y;
                pathWeights[idx] = res.weight;
            }
        }

        // 3. Apply Laplacian Smoothing (2 passes)
        const smoothHeights = new Float32Array(rawHeights.length);
        smoothHeights.set(rawHeights); // Copy boundary values
        
        // Helper to get raw index
        const getIdx = (r, c) => r * rawW + c;

        for (let pass = 0; pass < 2; pass++) {
            // Only smooth internal grid (actual vertices), reading from padded
            // But we can smooth the padding too if we want, but checking boundaries is enough
            const source = pass === 0 ? rawHeights : smoothHeights;
            const target = pass === 0 ? smoothHeights : rawHeights; // ping-pong if odd passes, but here I'll just write to smoothHeights

            for (let j = 1; j <= gridD; j++) {
                for (let i = 1; i <= gridW; i++) {
                    const idx = getIdx(j, i);
                    
                    // 5-point stencil
                    const val = source[idx];
                    const up = source[getIdx(j-1, i)];
                    const down = source[getIdx(j+1, i)];
                    const left = source[getIdx(j, i-1)];
                    const right = source[getIdx(j, i+1)];

                    // Simple averaging
                    target[idx] = (val * 4 + up + down + left + right) * 0.125;
                }
            }
        }
        // Result is in rawHeights if 2 passes? 
        // Pass 0: raw -> smooth. Pass 1: smooth -> raw.
        // Wait, standard ping pong.
        // Let's just do one robust pass into a new buffer.
        // Actually, let's effectively reuse buffer or keep it simple.
        // I will use `smoothHeights` as the result.
        // Pass 1: Read `rawHeights`, write `smoothHeights`.
        
        for (let j = 1; j <= gridD; j++) {
            for (let i = 1; i <= gridW; i++) {
                const idx = getIdx(j, i);
                const val = rawHeights[idx];
                const neighbors = rawHeights[getIdx(j-1,i)] + rawHeights[getIdx(j+1,i)] + rawHeights[getIdx(j,i-1)] + rawHeights[getIdx(j,i+1)];
                const diagonals = rawHeights[getIdx(j-1,i-1)] + rawHeights[getIdx(j-1,i+1)] + rawHeights[getIdx(j+1,i-1)] + rawHeights[getIdx(j+1,i+1)];
                
                // Gaussian-ish
                smoothHeights[idx] = (val * 4 + neighbors * 2 + diagonals * 1) / 16;
            }
        }

        // 4. Construct Geometry
        const geometry = new THREE.PlaneGeometry(width, depth, widthSegments, depthSegments);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, 0, zCenter); // Center it properly

        const posAttr = geometry.attributes.position;
        const colors = [];
        const normals = [];
        
        // Temp vectors for normal calc
        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        const vC = new THREE.Vector3();
        const cb = new THREE.Vector3();
        const ab = new THREE.Vector3();

        for (let j = 0; j <= gridD - 1; j++) { // PlaneGeometry segments are grid+1 verts? Yes.
            // PlaneGeometry creates (segW+1)*(segD+1) vertices.
            // Row major.
            for (let i = 0; i <= gridW - 1; i++) {
                const vIdx = j * (gridW) + i; // Plane geo index
                
                // Map to padded grid index (j+1, i+1)
                const gridIdx = getIdx(j+1, i+1);
                
                const h = smoothHeights[gridIdx];
                const x = posAttr.getX(vIdx);
                const z = posAttr.getZ(vIdx);
                
                posAttr.setY(vIdx, h);

                // Calculate Normal using 5-point (finite difference) on smoothed grid
                const hL = smoothHeights[getIdx(j+1, i)];   // x-1
                const hR = smoothHeights[getIdx(j+1, i+2)]; // x+1
                const hU = smoothHeights[getIdx(j, i+1)];   // z+1 (up in grid, +Z is up in array but -Z in world... carefully)
                // Grid j is 0 at top (max Z). j increases as Z decreases.
                // So j-1 is Higher Z. j+1 is Lower Z.
                const hD = smoothHeights[getIdx(j+2, i+1)]; 

                // Tangents
                // dx = 2 * cellW
                // dz = 2 * cellD
                
                // Normal approximation
                const nx = (hL - hR) / (2 * cellW);
                const nz = (hD - hU) / (2 * cellD); // Flip Z because array is inverted relative to world? 
                // Wait. World Z decreases as j increases.
                // Slope dz = (Height(j+1) - Height(j-1)) / (z(j+1) - z(j-1))
                // z(j+1) < z(j-1). Denom is negative.
                // Let's stick to standard vector cross product logic or simple finite diff.
                // Vector along X: (2*cellW, hR-hL, 0)
                // Vector along Z: (0, hD-hU, -2*cellD)  (Since D is lower Z)
                
                vA.set(2*cellW, hR-hL, 0).normalize();
                vB.set(0, hD-hU, -2*cellD).normalize();
                vC.crossVectors(vB, vA).normalize();
                
                normals.push(vC.x, vC.y, vC.z);

                // Color blending
                // Calculate slope for color logic
                const slope = 1.0 - vC.y; 
                let col = Terrain.getColor(x, z, h, slope);

                // Apply Path Color
                const w = pathWeights[gridIdx];
                if (w > 0.01) {
                    // Wet/Darker sand near water handled by shader/wetness later? 
                    // No, bake it into vertex color for now.
                    const blend = w * 0.95;
                    // Path color
                    const pr = 0.55; const pg = 0.48; const pb = 0.38;
                    col.r = lerp(col.r, pr, blend);
                    col.g = lerp(col.g, pg, blend);
                    col.b = lerp(col.b, pb, blend);
                }
                
                colors.push(col.r, col.g, col.b);
            }
        }

        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        
        const terrainMesh = new THREE.Mesh(geometry, this.assets.terrainMaterial);
        terrainMesh.receiveShadow = true;
        group.add(terrainMesh);

        // 5. Generate Water Mesh
        // High density plane
        const waterGeo = new THREE.PlaneGeometry(width, depth, 90, 40);
        waterGeo.rotateX(-Math.PI / 2);
        waterGeo.translate(0, Terrain.WATER_LEVEL, zCenter);
        
        // Add terrain height attribute for shader depth effects
        const terrainHeights = [];
        const wPos = waterGeo.attributes.position;
        for(let i=0; i<wPos.count; i++) {
            const wx = wPos.getX(i);
            const wz = wPos.getZ(i);
            // Sample from our smooth grid!
            // Map wx, wz to grid coords
            // wx = originX + i*cellW... inverse:
            let gi = (wx - originX) / cellW;
            let gj = (originZ - wz) / cellD;
            
            // Bilinear interpolate from smoothHeights
            const gji = Math.floor(gj); const gjf = gj - gji;
            const gii = Math.floor(gi); const gif = gi - gii;
            
            // Clamp to valid range (1 to gridW)
            const cj = Math.max(1, Math.min(gridD, gji + 1));
            const ci = Math.max(1, Math.min(gridW, gii + 1));
            // We need 4 samples
            const h00 = smoothHeights[getIdx(cj, ci)];
            const h10 = smoothHeights[getIdx(cj+1, ci)];
            const h01 = smoothHeights[getIdx(cj, ci+1)];
            const h11 = smoothHeights[getIdx(cj+1, ci+1)];
            
            const hLerp = (h00 * (1-gjf) + h10 * gjf) * (1-gif) + (h01 * (1-gjf) + h11 * gjf) * gif;
            
            terrainHeights.push(hLerp);
        }
        
        waterGeo.setAttribute('aTerrainHeight', new THREE.Float32BufferAttribute(terrainHeights, 1));
        
        const waterMesh = new THREE.Mesh(waterGeo, this.assets.waterMaterial);
        group.add(waterMesh);

        return group;
    }
    
    // Legacy method removal or stub
    generateTerrainStrip() { return new THREE.Mesh(); }
}