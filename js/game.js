import * as THREE from 'three';
import { BoardGenerator } from './board-gen.js';
import { Storage } from './storage.js';
import { Graphics } from './graphics.js';

export class Game {
    constructor() {
        this.graphics = new Graphics(document.body);
        this.generator = new BoardGenerator();
        
        this.chunks = new Map();
        this.currentNode = null;
        this.isMoving = false;
        this.moveProgress = 0;
        this.startMovePos = new THREE.Vector3();
        this.targetMovePos = new THREE.Vector3();
        
        this.score = 0;
        this.scoreEl = document.getElementById('score');
        
        this.init();
        
        window.addEventListener('resize', () => this.graphics.resize());
        
        // Touch/Click handling
        const canvas = this.graphics.renderer.domElement;
        canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        
        document.getElementById('reset-btn').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent click-through to board
            this.reset();
        });

        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
    }

    async init() {
        const savedState = Storage.getPlayerState();
        
        // Always ensure chunk 0
        await this.ensureChunk(0);
        
        let startNode = this.chunks.get(0).nodes.find(n => n.id === 'node_start');

        if (savedState && savedState.currentNodeId) {
            this.score = savedState.score || 0;
            this.updateScoreUI();
            
            // Load necessary chunk
            const chunkIdx = this.getChunkIndexFromNodeId(savedState.currentNodeId);
            await this.ensureChunk(chunkIdx);
            // Load previous chunk for edges if needed
            if (chunkIdx > 0) await this.ensureChunk(chunkIdx - 1);
            
            const mesh = this.graphics.meshMap.get(savedState.currentNodeId);
            if (mesh) {
                this.currentNode = mesh.userData;
            } else {
                // Fallback
                this.currentNode = startNode;
            }
        } else {
            this.currentNode = startNode;
        }

        this.graphics.createPlayer(new THREE.Vector3(this.currentNode.x, this.currentNode.y, this.currentNode.z));
        this.graphics.updateCamera(new THREE.Vector3(this.currentNode.x, this.currentNode.y, this.currentNode.z));
        
        this.checkChunkLoad();
    }

    getChunkIndexFromNodeId(id) {
        if(id === 'node_start') return 0;
        const parts = id.split('_'); 
        if(parts[0].startsWith('c')) {
            return parseInt(parts[0].substring(1));
        }
        return 0;
    }

    async ensureChunk(index) {
        if (this.chunks.has(index)) return;

        let chunkData = Storage.getChunk(index);
        
        if (!chunkData) {
            let prevExitNodes = [];
            if (index > 0) {
                if (!this.chunks.has(index - 1)) await this.ensureChunk(index - 1);
                prevExitNodes = this.chunks.get(index - 1).exitNodes;
            }
            chunkData = this.generator.generateChunk(index, prevExitNodes);
            Storage.saveChunk(index, chunkData);
        }

        this.chunks.set(index, chunkData);
        
        // Visualize current chunk
        // If we have a next chunk (unlikely in linear play, but possible), pass it for path smoothing
        const nextChunk = this.chunks.get(index + 1);
        this.graphics.addChunkVisuals(chunkData, nextChunk);

        // Update previous chunk to smooth paths leading into this new chunk
        if (index > 0) {
            const prevChunk = this.chunks.get(index - 1);
            if (prevChunk) {
                this.graphics.addChunkVisuals(prevChunk, chunkData);
            }
        }
    }

    onPointerDown(event) {
        if (this.isMoving) return;
        event.preventDefault();
        
        const node = this.graphics.getIntersectedNode(event.clientX, event.clientY);
        if (node && node.id !== this.currentNode.id) {
            this.attemptMove(node);
        }
    }

    attemptMove(targetNode) {
        const currentChunkIdx = this.getChunkIndexFromNodeId(this.currentNode.id);
        const targetChunkIdx = this.getChunkIndexFromNodeId(targetNode.id);
        
        let relevantEdges = [];
        if (this.chunks.has(currentChunkIdx)) relevantEdges.push(...this.chunks.get(currentChunkIdx).edges);
        if (this.chunks.has(targetChunkIdx) && targetChunkIdx !== currentChunkIdx) {
            relevantEdges.push(...this.chunks.get(targetChunkIdx).edges);
        }

        const isConnected = relevantEdges.some(e => 
            (e.from === this.currentNode.id && e.to === targetNode.id) ||
            (e.from === targetNode.id && e.to === this.currentNode.id)
        );

        if (isConnected) {
            // Visual feedback - flash node?
            this.startMove(targetNode);
        }
    }

    startMove(targetNode) {
        this.isMoving = true;
        this.moveProgress = 0;
        this.startMovePos.set(this.currentNode.x, this.currentNode.y, this.currentNode.z);
        this.targetMovePos.set(targetNode.x, targetNode.y, targetNode.z);
        
        this.currentNode = targetNode;
        this.score++;
        this.updateScoreUI();
        
        Storage.savePlayerState({
            score: this.score,
            currentNodeId: this.currentNode.id
        });
        
        this.checkChunkLoad();
    }
    
    checkChunkLoad() {
        const currentChunkIdx = this.getChunkIndexFromNodeId(this.currentNode.id);
        // Load next 2 chunks to be safe
        this.ensureChunk(currentChunkIdx + 1);
        this.ensureChunk(currentChunkIdx + 2);
    }

    updateScoreUI() {
        this.scoreEl.innerText = `Steps: ${this.score}`;
    }

    animate() {
        requestAnimationFrame(this.animate);

        if (this.isMoving) {
            this.moveProgress += 0.08; // Movement speed
            if (this.moveProgress >= 1) {
                this.moveProgress = 1;
                this.isMoving = false;
            }
            
            const t = this.moveProgress;
            // Ease out cubic
            const ease = 1 - Math.pow(1 - t, 3);
            
            const pos = new THREE.Vector3().lerpVectors(this.startMovePos, this.targetMovePos, ease);
            // Parabolic jump
            pos.y += Math.sin(t * Math.PI) * 1.5;
            
            this.graphics.updatePlayerPosition(pos);
        }
        
        const camTarget = this.isMoving ? 
             this.graphics.playerMesh.position : // Follow player exactly during move
             new THREE.Vector3(this.currentNode.x, this.currentNode.y, this.currentNode.z);
            
        this.graphics.updateCamera(camTarget);
        this.graphics.render();
    }

    reset() {
        if(confirm("Reset progress?")) {
            Storage.clearAll();
            location.reload();
        }
    }
}