import { Injectable, inject } from '@angular/core';
import { AlertController } from '@ionic/angular';

export interface ConfirmOptions {
  header: string;
  message: string;
  /** Text of the confirming button, e.g. "Delete". */
  confirmText: string;
  /** Shows the confirming button in red for actions that remove things. */
  destructive?: boolean;
  /** Text of the declining button; "Cancel" by default. */
  cancelText?: string;
}

/** In-app confirmation dialog (Ionic alert) instead of the browser's window.confirm. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly alerts = inject(AlertController);

  async ask(options: ConfirmOptions): Promise<boolean> {
    const alert = await this.alerts.create({
      header: options.header,
      message: options.message,
      buttons: [
        { text: options.cancelText ?? 'Cancel', role: 'cancel' },
        {
          text: options.confirmText,
          role: 'confirm',
          cssClass: options.destructive ? 'alert-button-danger' : undefined,
        },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }
}
