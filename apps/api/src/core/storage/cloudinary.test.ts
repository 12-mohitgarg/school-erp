/**
 * Storage URL validation.
 *
 * This is the security boundary that makes browser-side uploads safe. The file
 * goes straight from the browser to Cloudinary and the client then tells us the
 * URL — so the client controls that string entirely. Every case below is one a
 * hostile client can actually send, and each one that slips through puts an
 * attacker-chosen link into the document tables, rendered inside the admin UI.
 */

import { describe, expect, it } from 'vitest';
import {
  assertStorableUrl,
  isCloudinaryUrl,
  isStorageConfigured,
  publicIdFromUrl,
  storageConfig,
} from './cloudinary.js';

const OURS = 'https://res.cloudinary.com/test-cloud/image/upload/v1712345678/school-erp/doc.jpg';

describe('isCloudinaryUrl', () => {
  it('accepts a delivery URL from our own cloud', () => {
    expect(isCloudinaryUrl(OURS)).toBe(true);
  });

  it('accepts raw and video resource types', () => {
    expect(isCloudinaryUrl('https://res.cloudinary.com/test-cloud/raw/upload/v1/a.pdf')).toBe(true);
    expect(isCloudinaryUrl('https://res.cloudinary.com/test-cloud/video/upload/v1/a.mp4')).toBe(true);
  });

  it('rejects a look-alike host that only shares a prefix', () => {
    // The bug a regex `startsWith` check would have: the real host is a
    // *subdomain label* of a domain the attacker controls.
    expect(isCloudinaryUrl('https://res.cloudinary.com.attacker.test/test-cloud/image/upload/x.jpg')).toBe(false);
  });

  it('rejects another account on the same host', () => {
    expect(isCloudinaryUrl('https://res.cloudinary.com/someone-else/image/upload/v1/x.jpg')).toBe(false);
  });

  it('rejects a cloud name that merely starts with ours', () => {
    // `/test-cloud` must not match `/test-cloud-evil`, which a naive
    // `pathname.startsWith(cloud)` without the trailing slash would allow.
    expect(isCloudinaryUrl('https://res.cloudinary.com/test-cloud-evil/image/upload/x.jpg')).toBe(false);
  });

  it('rejects plaintext http', () => {
    expect(isCloudinaryUrl('http://res.cloudinary.com/test-cloud/image/upload/x.jpg')).toBe(false);
  });

  it('rejects non-http schemes', () => {
    expect(isCloudinaryUrl('javascript:alert(1)')).toBe(false);
    expect(isCloudinaryUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isCloudinaryUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects unparseable input rather than throwing', () => {
    expect(isCloudinaryUrl('')).toBe(false);
    expect(isCloudinaryUrl('not a url')).toBe(false);
    expect(isCloudinaryUrl('//res.cloudinary.com/test-cloud/image/upload/x.jpg')).toBe(false);
  });
});

describe('assertStorableUrl', () => {
  it('returns the URL unchanged when it is ours', () => {
    expect(assertStorableUrl(OURS)).toBe(OURS);
  });

  it('throws a 400 naming the field, not a 500', () => {
    // The message reaches the user, so it has to say which field is wrong.
    expect(() => assertStorableUrl('https://evil.test/x.jpg', 'logoUrl')).toThrowError(/logoUrl/);

    try {
      assertStorableUrl('https://evil.test/x.jpg');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(400);
    }
  });

  it('rejects an internal address, closing the SSRF path', () => {
    expect(() => assertStorableUrl('http://169.254.169.254/latest/meta-data/')).toThrow();
    expect(() => assertStorableUrl('http://localhost:4000/api/v1/students')).toThrow();
  });
});

describe('publicIdFromUrl', () => {
  it('strips the version segment and the extension for an image', () => {
    expect(publicIdFromUrl(OURS)).toBe('school-erp/doc');
  });

  it('keeps the extension for a raw asset, which is part of its id', () => {
    expect(
      publicIdFromUrl('https://res.cloudinary.com/test-cloud/raw/upload/v1/school-erp/report.pdf'),
    ).toBe('school-erp/report.pdf');
  });

  it('handles a URL with no version segment', () => {
    expect(
      publicIdFromUrl('https://res.cloudinary.com/test-cloud/image/upload/school-erp/a/b.png'),
    ).toBe('school-erp/a/b');
  });

  it('returns null for anything not ours, so we never try to delete it', () => {
    expect(publicIdFromUrl('https://evil.test/x.jpg')).toBeNull();
  });
});

describe('storageConfig', () => {
  it('reports configured and exposes the four upload endpoints', () => {
    const config = storageConfig();

    expect(isStorageConfigured()).toBe(true);
    expect(config.cloudName).toBe('test-cloud');
    expect(config.uploadPreset).toBe('test-preset');
    expect(config.endpoints?.image).toContain('/test-cloud/image/upload');
    expect(config.endpoints?.raw).toContain('/test-cloud/raw/upload');
  });

  it('never leaks the API secret to the client payload', () => {
    // This object is served to the browser, so a stray field here would
    // publish a signing credential to every signed-in user.
    const serialised = JSON.stringify(storageConfig());

    expect(serialised).not.toMatch(/secret/i);
    expect(serialised).not.toMatch(/api_key|apiKey/i);
  });
});
