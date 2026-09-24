import { test } from 'node:test';
import assert from 'node:assert/strict';

import { opsDocumentFilename } from './opsDocumentFile.js';

test('a document saves under its label with the extension the bytes are', () => {
  assert.equal(opsDocumentFilename('PAN card', 'application/pdf'), 'PAN card.pdf');
  assert.equal(opsDocumentFilename('PAN card', 'image/jpeg'), 'PAN card.jpg');
  assert.equal(opsDocumentFilename('PAN card', 'image/png; charset=binary'), 'PAN card.png');
});

test('a label that already claims an extension takes the real one instead', () => {
  assert.equal(opsDocumentFilename('Shipment KYC.pdf', 'image/jpeg'), 'Shipment KYC.jpg');
  assert.equal(opsDocumentFilename('aadhaar.JPG', 'application/pdf'), 'aadhaar.pdf');
});

test('characters a filesystem rejects never reach the disk', () => {
  assert.equal(opsDocumentFilename('GST: 27/AB*cd?', 'application/pdf'), 'GST- 27-AB-cd-.pdf');
  assert.equal(opsDocumentFilename('  ', 'application/pdf'), 'document.pdf');
});

test('an unknown type keeps the label as it stands', () => {
  assert.equal(opsDocumentFilename('Contract.p7s', 'application/octet-stream'), 'Contract.p7s');
});
