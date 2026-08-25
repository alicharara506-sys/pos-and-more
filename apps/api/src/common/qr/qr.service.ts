import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';

/**
 * Thin wrapper around the `qrcode` library — genuine QR encoding (not a
 * placeholder image), returned as a PNG data URL so callers (both the
 * authenticated dashboard and the public invoice page) can embed it
 * directly in an <img> tag with no extra round-trip.
 */
@Injectable()
export class QrService {
  async toDataUrl(content: string): Promise<string> {
    return QRCode.toDataURL(content, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
  }
}
