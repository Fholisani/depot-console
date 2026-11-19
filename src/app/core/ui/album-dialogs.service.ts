import { Injectable, inject } from '@angular/core';
import { AlertController } from '@ionic/angular';
import type { Album, Namespace } from '../api/models';

/** Small dialogs used when putting files into albums and sharing them. */
@Injectable({ providedIn: 'root' })
export class AlbumDialogs {
  private readonly alerts = inject(AlertController);

  /** Name and description for a new album, or null when cancelled. */
  async newAlbum(header = 'New album', name = ''): Promise<{ name: string; description: string | null } | null> {
    const alert = await this.alerts.create({
      header,
      inputs: [
        { name: 'name', type: 'text', placeholder: 'Name, for example Braai 15 Nov', value: name,
          attributes: { maxlength: 120, 'aria-label': 'Album name' } },
        { name: 'description', type: 'textarea', placeholder: 'Description (optional)',
          attributes: { maxlength: 280, 'aria-label': 'Album description' } },
      ],
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Save', role: 'confirm' }],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values: { name?: string; description?: string } }>();
    const n = data?.values?.name?.trim() ?? '';
    if (role !== 'confirm' || !n) {
      return null;
    }
    const d = data?.values?.description?.trim() ?? '';
    return { name: n, description: d || null };
  }

  /** Rename or describe an album; null when cancelled. */
  async editAlbum(album: Album): Promise<{ name: string; description: string } | null> {
    const alert = await this.alerts.create({
      header: 'Edit album',
      inputs: [
        { name: 'name', type: 'text', value: album.name, attributes: { maxlength: 120, 'aria-label': 'Album name' } },
        { name: 'description', type: 'textarea', value: album.description ?? '', placeholder: 'Description (optional)',
          attributes: { maxlength: 280, 'aria-label': 'Album description' } },
      ],
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Save', role: 'confirm' }],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values: { name?: string; description?: string } }>();
    const n = data?.values?.name?.trim() ?? '';
    if (role !== 'confirm' || !n) {
      return null;
    }
    return { name: n, description: data?.values?.description?.trim() ?? '' };
  }

  /** A link's new note ('' removes it), or null when cancelled. */
  async editNote(current: string): Promise<string | null> {
    const alert = await this.alerts.create({
      header: 'Link note',
      subHeader: 'Shows in the link preview instead of the album description.',
      inputs: [{ name: 'note', type: 'textarea', value: current, placeholder: 'e.g. Photos from Sunday',
        attributes: { maxlength: 280, 'aria-label': 'Link note' } }],
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Save', role: 'confirm' }],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values: { note?: string } }>();
    return role === 'confirm' ? (data?.values?.note?.trim() ?? '') : null;
  }

  /** One of the albums, or null when cancelled. */
  async pickAlbum(albums: Album[]): Promise<Album | null> {
    const alert = await this.alerts.create({
      header: 'Add to album',
      inputs: albums.map((a, i) => ({
        type: 'radio' as const, label: `${a.name} (${a.itemCount})`, value: a.id, checked: i === 0,
      })),
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Next', role: 'confirm' }],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values: string }>();
    return role === 'confirm' ? (albums.find((a) => a.id === data?.values) ?? null) : null;
  }

  /** The folder uploads from an album go into, or null when cancelled. */
  async pickFolder(namespaces: Namespace[], current: string): Promise<string | null> {
    const alert = await this.alerts.create({
      header: 'Upload into which folder?',
      message: 'Every file lives in a folder. The album remembers this choice.',
      inputs: namespaces.map((n) => ({
        type: 'radio' as const, label: n.name, value: n.name, checked: n.name === current,
      })),
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Choose files', role: 'confirm' }],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values: string }>();
    return role === 'confirm' && data?.values ? data.values : null;
  }

  /** "3 already in this album, 5 will be added": true to go ahead. */
  async confirmAdd(album: string, already: number, adding: number): Promise<boolean> {
    if (adding === 0) {
      const info = await this.alerts.create({
        header: `Already in ${album}`,
        message: already === 1 ? 'That file is already in this album.' : `All ${already} files are already in this album.`,
        buttons: [{ text: 'OK', role: 'cancel' }],
      });
      await info.present();
      await info.onDidDismiss();
      return false;
    }
    const alert = await this.alerts.create({
      header: `Add to ${album}?`,
      message: already > 0
        ? `${already} already in this album, ${adding} will be added.`
        : `${adding} ${adding === 1 ? 'file' : 'files'} will be added.`,
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Add', role: 'confirm' }],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }
}
