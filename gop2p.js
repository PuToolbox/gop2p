const peerId = Math.random().toString(36).substring(2, 15);
const files = new Map();
const EXPIRY_TIME = Number(document.querySelector('script[data-expiry-time]').dataset.expiryTime);
const MAX_FILE_SIZE = Number(document.querySelector('script[data-max-file-size]').dataset.maxFileSize);

// Fetch current encryption key from server
async function fetchCurrentKey() {
    const response = await fetch('get_key.php');
    if (!response.ok) {
        throw new Error('Failed to fetch encryption key');
    }
    const keyData = await response.json();
    return keyData.current_key;
}

// Decode base64 key and validate length
async function decodeKey(base64Key) {
    try {
        const binaryString = atob(base64Key);
        const keyData = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            keyData[i] = binaryString.charCodeAt(i);
        }
        if (keyData.length !== 32) {
            throw new Error(`Encryption key must be 32 bytes, got ${keyData.length} bytes`);
        }
        return keyData;
    } catch (err) {
        throw new Error('Failed to decode encryption key: ' + err.message);
    }
}

// Encrypt file (client-side)
async function encryptFile(file) {
    try {
        const base64Key = await fetchCurrentKey();
        const keyData = await decodeKey(base64Key);
        const key = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'AES-GCM' },
            false,
            ['encrypt']
        );
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            await file.arrayBuffer()
        );
        return { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)), type: file.type, key: base64Key };
    } catch (err) {
        console.error('Encryption error:', err);
        throw err;
    }
}

// Decrypt and download file
async function decryptAndDownload(filename, encrypted, type) {
    try {
        const response = await fetch('get_key.php');
        const responseData = await response.json();
        const keys = [responseData.current_key, responseData.previous_key].filter(Boolean);
        
        let decrypted = null;
        for (const base64Key of keys) {
            try {
                const keyData = await decodeKey(base64Key);
                const cryptoKey = await crypto.subtle.importKey(
                    'raw',
                    keyData,
                    { name: 'AES-GCM' },
                    false,
                    ['decrypt']
                );
                decrypted = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) },
                    cryptoKey,
                    new Uint8Array(encrypted.data)
                );
                break;
            } catch (err) {
                console.warn('Decryption failed with one key, trying next:', err);
            }
        }
        
        if (!decrypted) {
            throw new Error('Decryption failed with all available keys');
        }
        
        const blob = new Blob([decrypted], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.replace('.enc', '');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Decryption error:', err);
        alert('Failed to decrypt file: ' + err.message);
    }
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
    // Handle file upload
    const uploadForm = document.getElementById('uploadForm');
    if (uploadForm) {
        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fileInput = document.getElementById('file');
            const file = fileInput.files[0];
            if (!file) {
                alert('No file selected.');
                return;
            }

            if (file.size > MAX_FILE_SIZE) {
                alert('File size exceeds 10MB limit.');
                return;
            }

            const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
            if (!allowedTypes.includes(file.type)) {
                alert('Invalid file type. Allowed: JPEG, PNG, GIF, PDF.');
                return;
            }

            try {
                // Encrypt and store client-side
                const encrypted = await encryptFile(file);
                files.set(file.name, { encrypted, time: Date.now() });
                console.log('File stored client-side:', file.name);

                // Upload to server for metadata and fallback
                const formData = new FormData();
                formData.append('file', file);
                const response = await fetch('', {
                    method: 'POST',
                    body: formData
                });
                if (response.ok) {
                    // Update peerId in metadata
                    const filename = file.name.replace(/\.[^/.]+$/, '') + '.enc';
                    const metadataResponse = await fetch('update_metadata.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename, peerId })
                    });
                    if (metadataResponse.ok) {
                        console.log('Metadata updated with peerId:', peerId);
                        location.reload();
                    } else {
                        console.error('Metadata update failed:', await metadataResponse.text());
                        alert('Failed to update metadata.');
                    }
                } else {
                    console.error('Server upload failed:', await response.text());
                    alert('Server upload failed.');
                }
            } catch (err) {
                console.error('Upload error:', err);
                alert('Upload failed: ' + err.message);
            }
        });
    }

    // Handle file download
    document.querySelectorAll('.open-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            const filename = button.dataset.filename;
            const peerIdRequested = button.dataset.peerId;

            if (peerIdRequested === peerId && files.has(filename.replace('.enc', ''))) {
                console.log('Serving file from client:', filename);
                const fileData = files.get(filename.replace('.enc', ''));
                await decryptAndDownload(filename, fileData.encrypted, fileData.encrypted.type);
            } else {
                console.log('Falling back to server download for:', filename);
                window.location.href = `?download=${filename}`;
            }
        });
    });
});

// Clean up expired files client-side
setInterval(() => {
    const now = Date.now();
    files.forEach((fileData, filename) => {
        if (now - fileData.time > EXPIRY_TIME) {
            files.delete(filename);
            console.log('Expired file removed:', filename);
        }
    });
}, 1000);