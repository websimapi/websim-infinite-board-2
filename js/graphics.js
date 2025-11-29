import * as THREE from 'three';
import { Terrain } from './board-gen.js';
import { AssetManager } from './assets.js';
import { TerrainVisuals } from './terrain-visuals.js';

export class Graphics {
    constructor(container) {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0b0b14, 0.015);
        this.scene.background = new THREE.Color(0x0b0b14);

        // Angled top-down view
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 20, 15);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        // Lighting
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.2); // Start darker for dynamic cycle
        this.scene.add(this.ambientLight);

        // Main directional light (Sun) for better shading
        this.sunLight = new THREE.DirectionalLight(0xffeedd, 1.0);
        this.sunLight.position.set(50, 80, 50);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.width = 2048;
        this.sunLight.shadow.mapSize.height = 2048;
        this.sunLight.shadow.camera.near = 0.5;
        this.sunLight.shadow.camera.far = 500;
        const shadowSize = 100;
        this.sunLight.shadow.camera.left = -shadowSize;
        this.sunLight.shadow.camera.right = shadowSize;
        this.sunLight.shadow.camera.top = shadowSize;
        this.sunLight.shadow.camera.bottom = -shadowSize;
        this.sunLight.shadow.bias = -0.0005;
        this.scene.add(this.sunLight);

        // Player point light (reduced intensity)
        const pointLight = new THREE.PointLight(0x44aaff, 0.5, 40);
        pointLight.position.set(0, 10, 0);
        this.scene.add(pointLight);
        this.followLight = pointLight; // Will follow player

        // Animation Clock
        this.clock = new THREE.Clock();

        // Zoom Control
        this.zoom = 1.0;
        this.minZoom = 0.5;
        this.maxZoom = 2.0;

        // Desktop Zoom
        window.addEventListener('wheel', (e) => {
            const delta = Math.sign(e.deltaY) * 0.1;
            this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + delta));
        }, { passive: true });

        // Mobile Pinch Zoom
        let initialPinchDist = 0;
        let startZoom = 1.0;

        this.renderer.domElement.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                initialPinchDist = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                startZoom = this.zoom;
            }
        }, { passive: false });

        this.renderer.domElement.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const dist = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                if (initialPinchDist > 0) {
                    const scale = initialPinchDist / dist;
                    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, startZoom * scale));
                }
            }
        }, { passive: false });

        this.assets = new AssetManager();
        this.terrainVisuals = new TerrainVisuals(this.assets);

        this.meshMap = new Map();
        this.chunkGroups = new Map(); // Track chunk visuals to update/remove
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
    }

    addChunkVisuals(chunkData, nextChunkData = null) {
        // Remove existing chunk visual if updating
        if (this.chunkGroups.has(chunkData.index)) {
            const oldGroup = this.chunkGroups.get(chunkData.index);
            this.scene.remove(oldGroup);
            chunkData.nodes.forEach(node => this.meshMap.delete(node.id));
            oldGroup.traverse(o => {
                if (o.geometry) o.geometry.dispose();
            });
            this.chunkGroups.delete(chunkData.index);
        }

        // Use the new simplified generation method
        const group = this.terrainVisuals.generateChunkVisuals(chunkData, nextChunkData);

        // Add Nodes and Edges (Logic remains similar but simplified here for brevity, 
        // essentially just re-adding the nodes on top of the terrain)
        
        chunkData.nodes.forEach(node => {
            const mesh = new THREE.Mesh(this.assets.nodeGeometry, this.assets.nodeMaterial.clone());
            // Adjust y slightly to ensure it sits on visual mesh? 
            // The visual mesh is smoothed, but node.y is raw.
            // Ideally we'd sample the visual mesh height, but raw is close enough for nodes.
            mesh.position.set(node.x, node.y + 0.1, node.z);
            mesh.userData = { isNode: true, id: node.id, ...node };
            
            if (node.id === 'node_start') mesh.material.emissive.setHex(0x00ff88);
            
            group.add(mesh);
            this.meshMap.set(node.id, mesh);
        });

        chunkData.edges.forEach(edge => {
            const startMesh = this.meshMap.get(edge.from);
            // We need to find endNode in this chunk or assume it's valid
            const endNode = chunkData.nodes.find(n => n.id === edge.to);
            // If edge goes to next chunk, we might not have the mesh yet, so we rely on position data if available
            // but usually edges are drawn from 'from' node. 
            // If 'to' node is in next chunk, we can visualize it if we have nextChunkData
            let endPos = null;
            if (endNode) {
                endPos = new THREE.Vector3(endNode.x, endNode.y + 0.2, endNode.z);
            } else if (nextChunkData) {
                const nextNode = nextChunkData.nodes.find(n => n.id === edge.to);
                if (nextNode) endPos = new THREE.Vector3(nextNode.x, nextNode.y + 0.2, nextNode.z);
            }

            if (startMesh && endPos) {
                const startPos = startMesh.position;
                const curve = new THREE.QuadraticBezierCurve3(
                    startPos,
                    new THREE.Vector3((startPos.x + endPos.x)/2, Math.max(startPos.y, endPos.y) + 3, (startPos.z + endPos.z)/2),
                    endPos
                );
                const points = curve.getPoints(12);
                const geometry = new THREE.BufferGeometry().setFromPoints(points);
                const line = new THREE.Line(geometry, this.assets.lineMaterial);
                group.add(line);
            }
        });

        this.scene.add(group);
        this.chunkGroups.set(chunkData.index, group);
        return group;
    }

    createPlayer(startPos) {
        this.playerMesh = new THREE.Mesh(this.assets.playerGeometry, this.assets.playerMaterial);
        this.playerMesh.position.copy(startPos);
        this.playerMesh.position.y += 0.8;
        this.scene.add(this.playerMesh);

        // Add a small light to player
        this.playerLight = new THREE.PointLight(0xff0055, 1, 10);
        this.playerMesh.add(this.playerLight);
    }

    updatePlayerPosition(pos) {
        if (this.playerMesh) {
            this.playerMesh.position.copy(pos);
            this.playerMesh.position.y += 0.8;

            // Update follow light
            this.followLight.position.set(pos.x, pos.y + 10, pos.z + 5);
        }
    }

    updateCamera(targetPos) {
        const offset = new THREE.Vector3(0, 25, 15).multiplyScalar(this.zoom); // Higher up, looking down
        const idealPos = targetPos.clone().add(offset);
        this.camera.position.lerp(idealPos, 0.08);
        this.camera.lookAt(targetPos);
    }

    getIntersectedNode(x, y) {
        this.mouse.x = (x / window.innerWidth) * 2 - 1;
        this.mouse.y = -(y / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        // Intersect recursive false to avoid hitting lines if possible, or filter
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        for (let hit of intersects) {
            // Ignore water for selection
            if (hit.object.geometry && hit.object.geometry.type === 'PlaneGeometry' && hit.object.material.transparent) continue;

            // Traverse up to find mesh with userData
            let obj = hit.object;
            while(obj) {
                if (obj.userData && obj.userData.isNode) {
                    return obj.userData;
                }
                obj = obj.parent;
            }
        }
        return null;
    }

    render() {
        const time = this.clock.getElapsedTime();
        
        // Update Water Shader Uniforms
        if (this.assets.waterMaterial.userData.shader) {
            this.assets.waterMaterial.userData.shader.uniforms.uTime.value = time;
        }

        this.updateDayNightCycle(time);

        this.renderer.render(this.scene, this.camera);
    }

    updateDayNightCycle(time) {
        // Cycle duration in seconds
        const dayDuration = 60;
        
        // Normalized time 0..1
        const t = (time % dayDuration) / dayDuration;
        
        // Calculate sun position (Dawn at 0, Noon at 0.25, Dusk at 0.5, Midnight at 0.75)
        const angle = (t * Math.PI * 2) - Math.PI / 2; // Start at -PI/2 (horizon)
        
        const orbitRadius = 100;
        const sunY = Math.sin(angle) * orbitRadius;
        const sunX = Math.cos(angle) * orbitRadius;
        
        // Update Sun Position
        this.sunLight.position.set(sunX, sunY, 30);
        this.sunLight.lookAt(0, 0, 0);

        // Colors
        const colorDay = new THREE.Color(0x87CEEB);   // Sky Blue
        const colorSunset = new THREE.Color(0xFD5E53); // Orange/Red
        const colorNight = new THREE.Color(0x050515); // Deep Dark Blue/Black
        
        const fogColor = new THREE.Color();
        let targetBg = new THREE.Color();
        
        // Smooth transitions
        const sunHeight = Math.sin(angle);
        
        if (sunHeight > 0.2) {
            // Day
            targetBg.copy(colorDay);
            this.sunLight.intensity = 1.2;
            this.ambientLight.intensity = 0.5;
            this.followLight.intensity = 0.2; // Dim player light during day
        } else if (sunHeight > -0.2) {
            // Dawn / Dusk transition
            const p = (sunHeight + 0.2) / 0.4; // 0 to 1
            targetBg.lerpColors(colorNight, colorDay, p);
            
            // Add sunset tint
            if (sunHeight < 0.1 && sunHeight > -0.1) {
                targetBg.lerp(colorSunset, 0.5);
            }

            this.sunLight.intensity = Math.max(0, sunHeight * 1.2);
            this.ambientLight.intensity = 0.1 + p * 0.4;
            this.followLight.intensity = 1.0 - p * 0.8;
        } else {
            // Night
            targetBg.copy(colorNight);
            this.sunLight.intensity = 0; // Sun off at night
            this.ambientLight.intensity = 0.1; // Moonlit
            this.followLight.intensity = 1.2; // Player light bright
        }

        // Interpolate current state
        this.scene.background.lerp(targetBg, 0.05);
        this.scene.fog.color.copy(this.scene.background);
    }

    resize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    clear() {
        // Quick clear for reset
        while(this.scene.children.length > 0){ 
            this.scene.remove(this.scene.children[0]); 
        }
        this.meshMap.clear();
        this.chunkGroups.clear();
    }
}