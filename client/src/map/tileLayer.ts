import type Phaser from 'phaser';
import type { MapTileData } from '../../../shared/maps/tiles';
import { tileKey } from '../../../shared/maps/tiles';
import { imageDataToTextureKey } from './pixelMap';
import { tilePreviewImageData } from './tileStore';

function textureKey(tx: number, ty: number): string {
  return `map-tile-${tx}-${ty}`;
}

/** One Phaser image per logical map tile. */
export class TileMapView {
  private sprites = new Map<string, Phaser.GameObjects.Image>();

  constructor(
    private scene: Phaser.Scene,
    private tileSize: number,
  ) {}

  addOrUpdate(tile: MapTileData): void {
    const key = tileKey(tile.tx, tile.ty);
    const texKey = textureKey(tile.tx, tile.ty);
    const imageData = tilePreviewImageData(tile);
    imageDataToTextureKey(this.scene, texKey, imageData);

    let img = this.sprites.get(key);
    if (!img) {
      img = this.scene.add
        .image(tile.tx * this.tileSize, tile.ty * this.tileSize, texKey)
        .setOrigin(0, 0)
        .setDepth(0);
      this.sprites.set(key, img);
    } else {
      img.setTexture(texKey);
    }
    img.setDisplaySize(tile.tw, tile.th);
  }

  remove(tx: number, ty: number): void {
    const key = tileKey(tx, ty);
    const img = this.sprites.get(key);
    if (img) {
      img.destroy();
      this.sprites.delete(key);
    }
    const texKey = textureKey(tx, ty);
    if (this.scene.textures.exists(texKey)) {
      this.scene.textures.remove(texKey);
    }
  }

  destroy(): void {
    for (const [key, img] of this.sprites) {
      img.destroy();
      const [tx, ty] = key.split(',').map(Number);
      const texKey = textureKey(tx, ty);
      if (this.scene.textures.exists(texKey)) {
        this.scene.textures.remove(texKey);
      }
    }
    this.sprites.clear();
  }
}
