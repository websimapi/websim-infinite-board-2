import * as THREE from 'three';

export class AssetManager {
    constructor() {
        // Shared Geometries
        this.nodeGeometry = new THREE.CylinderGeometry(1.2, 1.2, 0.3, 32);
        this.playerGeometry = new THREE.CapsuleGeometry(0.5, 1.5, 4, 8); // Capsule player
        
        // Materials
        this.nodeMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x222233, 
            emissive: 0x44aaff,
            emissiveIntensity: 0.3,
            roughness: 0.2,
            metalness: 0.8
        });

        this.playerMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xff0055,
            emissiveIntensity: 0.4,
            roughness: 0.3
        });

        this.lineMaterial = new THREE.LineBasicMaterial({ 
            color: 0x44aaff, 
            transparent: true, 
            opacity: 0.3 
        });

        this.terrainMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.9,
            metalness: 0.1,
            flatShading: false 
        });

        // Advanced Water Shader Material
        this.waterMaterial = new THREE.MeshStandardMaterial({
            color: 0x006699,
            roughness: 0.0,
            metalness: 0.3,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthWrite: false, // Important for transparency
        });

        this.waterMaterial.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = { value: 0 };
            this.waterMaterial.userData.shader = shader;

            shader.vertexShader = `
                uniform float uTime;
                attribute float aTerrainHeight;
                varying float vDepth;
                varying vec3 vWorldPos;
                varying vec2 vUv2;
                ${shader.vertexShader}
            `;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>
                vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
                
                // Calculate approximate water depth (Water Y is 0 in local space usually, but we need world)
                // Actually 'transformed.y' is local.
                // We know water level is fixed world Y, but let's assume mesh is at y=WaterLevel.
                // aTerrainHeight is the terrain height at this x,z.
                // We are at y=0 relative to the mesh, which is at WaterLevel.
                // Depth = WaterLevel - TerrainHeight.
                // But aTerrainHeight is world Y.
                // So depth = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y - aTerrainHeight;
                // Wait, simpler:
                float terrainH = aTerrainHeight;
                // Mesh is placed at WaterLevel. 
                // We can't access modelMatrix easily in 'begin_vertex' without extraction, 
                // but we know vertices are flat at Y=0 local.
                // Let's assume uniforms or pass it. 
                // Actually we can just use the attribute directly assuming the mesh is flat.
                
                // Depth estimation
                float waterLevel = -0.8; // Hardcoded or uniform
                float depth = max(0.0, waterLevel - terrainH);
                vDepth = depth;
                
                // Dampen waves near shore
                float waveDampen = smoothstep(0.0, 2.0, depth);
                
                float t = uTime * 0.5;
                
                // Multi-frequency waves
                float w = sin(transformed.x * 0.3 + t) * cos(transformed.z * 0.2 + t * 0.8) * 0.1;
                w += sin(transformed.x * 0.8 - t * 0.5) * 0.05;
                w += sin(transformed.z * 1.5 + t) * 0.02;
                
                transformed.y += w * waveDampen;
                `
            );

            shader.fragmentShader = `
                uniform float uTime;
                varying float vDepth;
                varying vec3 vWorldPos;
                
                // Noise for normals/foam
                float rand(vec2 n) { 
                    return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
                }
                float noise(vec2 p){
                    vec2 ip = floor(p);
                    vec2 u = fract(p);
                    u = u*u*(3.0-2.0*u);
                    float res = mix(
                        mix(rand(ip), rand(ip+vec2(1.0,0.0)), u.x),
                        mix(rand(ip+vec2(0.0,1.0)), rand(ip+vec2(1.0,1.0)), u.x), u.y);
                    return res*res;
                }
                
                ${shader.fragmentShader}
            `;

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <color_fragment>',
                `
                #include <color_fragment>
                
                // Deep water darkening
                vec3 shallowColor = vec3(0.2, 0.7, 0.9);
                vec3 deepColor = vec3(0.0, 0.2, 0.4);
                
                float depthFactor = smoothstep(0.0, 8.0, vDepth);
                vec3 waterCol = mix(shallowColor, deepColor, depthFactor);
                
                diffuseColor.rgb = mix(diffuseColor.rgb, waterCol, 0.6);
                
                // Foam at shore
                float foamNoise = noise(vWorldPos.xz * 2.0 + uTime * 0.2);
                float foamLine = smoothstep(0.5, 0.0, vDepth - foamNoise * 0.5);
                
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), foamLine);
                
                // Alpha based on depth
                diffuseColor.a = mix(0.4, 0.95, depthFactor);
                diffuseColor.a = max(diffuseColor.a, foamLine); // Foam is opaque
                `
            );
        }
    }

    dispose() {
        this.nodeGeometry.dispose();
        this.playerGeometry.dispose();
        this.nodeMaterial.dispose();
        this.playerMaterial.dispose();
        this.lineMaterial.dispose();
        this.terrainMaterial.dispose();
        this.waterMaterial.dispose();
    }
}