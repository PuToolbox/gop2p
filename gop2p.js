const peerId = Math.random().toString(36).substring(2, 15);
const files = new Map();
const EXPIRY_TIME = Number(document.querySelector('script[data-expiry-time]').dataset.expiryTime);
const MAX_FILE_SIZE = Number(document.querySelector('script[data-max-file-size]').dataset.maxFileSize);

// Fetch file list from server
async function fetchFileList() {
    try {
        const response = await fetch('gallery/files.json');
        if (!response.ok) {
            console.error(`Failed to fetch files.json: ${response.status}`);
            return;
        }
        const metadata = await response.json();
        console.log('Fetched files.json:', metadata);
        const now = Math.floor(Date.now() / 1000);
        const fileList = Object.entries(metadata).map(([filename, info]) => ({
            filename,
            name: info.name,
            type: info.type,
            peerId: info.peerId || '',
            expires_in: 300 - (now - info.time)
        })).filter(f => f.expires_in > 0);
        updateFileList(fileList);
    } catch (err) {
        console.error('fetchFileList error:', err);
    }
}

// Update file list dynamically without flickering
function updateFileList(files) {
    const fileList = document.getElementById('fileList');
    const existingFiles = new Map(
        Array.from(fileList.querySelectorAll('.message[data-filename]')).map(el => [
            el.dataset.filename,
            el
        ])
    );

    // Handle empty file list
    if (!files || files.length === 0) {
        if (existingFiles.size > 0) {
            fileList.innerHTML = '<div class="message">No files available.</div>';
            console.log('Cleared file list: no files available');
        }
        return;
    }

    // Remove "No files available" message if present
    const noFilesMessage = fileList.querySelector('.message:not([data-filename])');
    if (noFilesMessage) {
        noFilesMessage.remove();
        console.log('Removed no files message');
    }

    // Add or update files
    files.forEach(file => {
        if (existingFiles.has(file.filename)) {
            // Update expiration time
            const el = existingFiles.get(file.filename);
            const expiresSpan = el.querySelector('.message-text').lastChild;
            expiresSpan.textContent = ` (Expires in ${file.expires_in} seconds)`;
            existingFiles.delete(file.filename);
            console.log(`Updated expiration for: ${file.filename}`);
        } else {
            // Add new file
            const div = document.createElement('div');
            div.className = 'message';
            div.dataset.filename = file.filename;
            div.innerHTML = `
                <span class="message-name">${file.name}</span>
                <span class="message-text">
                    <a href="?download=${encodeURIComponent(file.filename)}" 
                       class="open-btn" 
                       data-filename="${encodeURIComponent(file.filename)}" 
                       data-peer-id="${file.peerId}" 
                       data-mime-type="${file.type}">Download</a>
                    (Expires in ${file.expires_in} seconds)
                </span>
            `;
            fileList.prepend(div);
            div.querySelector('.open-btn').addEventListener('click', handleDownload);
            console.log(`Added new file: ${file.filename}`);
        }
    });

    // Remove files that no longer exist
    existingFiles.forEach(el => {
        el.remove();
        console.log(`Removed old file: ${el.dataset.filename}`);
    });
}

// Update expiration countdowns client-side
function updateExpirationCountdown() {
    const fileList = document.getElementById('fileList');
    fileList.querySelectorAll('.message[data-filename]').forEach(el => {
        const expiresSpan = el.querySelector('.message-text').lastChild;
        const match = expiresSpan.textContent.match(/\d+/);
        if (match) {
            const seconds = parseInt(match[0]) - 1;
            if (seconds <= 0) {
                el.remove();
                console.log(`Removed expired file: ${el.dataset.filename}`);
            } else {
                expiresSpan.textContent = ` (Expires in ${seconds} seconds)`;
            }
        }
    });
}

// Show feedback message
function showFeedback(message, isError = false) {
    const feedbackDiv = document.createElement('div');
    feedbackDiv.className = isError ? 'error' : 'success';
    feedbackDiv.textContent = message;
    const contentDiv = document.querySelector('.content');
    contentDiv.insertBefore(feedbackDiv, contentDiv.firstChild);
    setTimeout(() => feedbackDiv.remove(), 3000);
}

// Fetch current encryption key from server
async function fetchCurrentKey() {
    try {
        const response = await fetch('get_key.php');
        if (!response.ok) {
            throw new Error(`Failed to fetch encryption key: ${response.status}`);
        }
        const keyData = await response.json();
        return keyData.current_key;
    } catch (err) {
        console.error('fetchCurrentKey error:', err);
        throw err;
    }
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
        console.error('decodeKey error:', err);
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
        console.error('encryptFile error:', err);
        throw err;
    }
}

// Decrypt and download file
async function decryptAndDownload(filename, encrypted, type) {
    try {
        const response = await fetch('get_key.php');
        if (!response.ok) {
            throw new Error(`Failed to fetch keys: ${response.status}`);
        }
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
        console.error('decryptAndDownload error:', err);
        showFeedback('Failed to decrypt file: ' + err.message, true);
    }
}

// P2P download function
async function downloadFromPeer(peerIdRequested, filename, type) {
    return new Promise((resolve, reject) => {
        const peer = new SimplePeer({ initiator: true });
        const timeout = setTimeout(() => {
            peer.destroy();
            reject(new Error('WebRTC connection timed out after 10 seconds'));
        }, 10000);

        peer.on('error', (err) => {
            clearTimeout(timeout);
            console.error('WebRTC peer error:', err);
            reject(err);
        });

        peer.on('signal', async (signalData) => {
            try {
                console.log('Sending signaling data for peer:', peerIdRequested);
                const response = await fetch('signal.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ peerId: peerIdRequested, signalData })
                });
                if (!response.ok) {
                    throw new Error(`Failed to send signaling data: ${response.status}`);
                }
                const { peerSignalData } = await response.json();
                if (peerSignalData) {
                    console.log('Received peer signaling data:', peerSignalData);
                    peer.signal(peerSignalData);
                }
            } catch (err) {
                clearTimeout(timeout);
                console.error('Signaling error:', err);
                reject(err);
            }
        });

        peer.on('connect', () => {
            clearTimeout(timeout);
            console.log('WebRTC connection established with peer:', peerIdRequested);
            peer.send(JSON.stringify({ filename }));
        });

        peer.on('data', (data) => {
            try {
                console.log('Received data from peer for:', filename);
                const encrypted = JSON.parse(data);
                decryptAndDownload(filename, encrypted, type);
                resolve();
            } catch (err) {
                console.error('Data processing error:', err);
                reject(err);
            }
        });
    });
}

// Handle uploader's signaling
function setupPeerServer() {
    const peer = new SimplePeer();
    peer.on('error', (err) => console.error('WebRTC peer error:', err));

    peer.on('signal', async (signalData) => {
        try {
            console.log('Uploader sending signaling data for peerId:', peerId);
            await fetch('signal.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ peerId, signalData })
            });
        } catch (err) {
            console.error('Failed to send uploader signaling data:', err);
        }
    });

    peer.on('connect', () => {
        console.log('WebRTC connection established as uploader');
    });

    peer.on('data', (data) => {
        try {
            const { filename } = JSON.parse(data);
            console.log('Uploader received request for:', filename);
            const originalFilename = Array.from(files.keys()).find(name => 
                files.get(name).serverFilename === filename
            );
            if (originalFilename && files.has(originalFilename)) {
                const fileData = files.get(originalFilename);
                peer.send(JSON.stringify(fileData.encrypted));
                console.log('Sent file to peer:', filename);
            } else {
                console.error('File not found in client:', filename, 'Available:', Array.from(files.keys()));
            }
        } catch (err) {
            console.error('Failed to send file data:', err);
        }
    });

    setInterval(async () => {
        try {
            const response = await fetch(`signal.php?peerId=${peerId}`);
            if (response.ok) {
                const signalData = await response.json();
                if (signalData) {
                    console.log('Uploader received signaling data:', signalData);
                    peer.signal(signalData);
                }
            }
        } catch (err) {
            console.error('Failed to fetch signaling data:', err);
        }
    }, 1000);
}

// Handle file download
function handleDownload(e) {
    e.preventDefault();
    const button = e.target;
    const filename = button.dataset.filename;
    const peerIdRequested = button.dataset.peerId;
    const mimeType = button.dataset.mimeType || 'application/octet-stream';

    console.log('Download initiated for:', filename, 'Peer ID:', peerIdRequested);

    if (peerIdRequested && peerIdRequested !== peerId) {
        console.log('Attempting P2P download from peer:', peerIdRequested);
        downloadFromPeer(peerIdRequested, filename, mimeType)
            .then(() => console.log('P2P download succeeded'))
            .catch(err => {
                console.error('P2P download failed:', err);
                console.log('Falling back to server download for:', filename);
                serverDownload(filename, button);
            });
    } else {
        console.log('Falling back to server download for:', filename);
        serverDownload(filename, button);
    }
}

// Server download fallback
async function serverDownload(filename, button) {
    try {
        const response = await fetch(`?download=${filename}`);
        if (!response.ok) {
            throw new Error(`Server download failed: ${response.status}`);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = button.closest('.message').querySelector('.message-name').textContent;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Server download error:', err);
        showFeedback('Download failed: ' + err.message, true);
    }
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
    setupPeerServer();

    // Set peerId in form
    const peerIdInput = document.getElementById('peerId');
    if (peerIdInput) {
        peerIdInput.value = peerId;
    }

    // Handle file upload
    const uploadForm = document.getElementById('uploadForm');
    if (uploadForm) {
        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fileInput = document.getElementById('file');
            const file = fileInput.files[0];
            if (!file) {
                showFeedback('No file selected.', true);
                return;
            }

            if (file.size > MAX_FILE_SIZE) {
                showFeedback('File size exceeds 10MB limit.', true);
                return;
            }

            const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
            if (!allowedTypes.includes(file.type)) {
                showFeedback('Invalid file type. Allowed: JPEG, PNG, GIF, PDF.', true);
                return;
            }

            try {
                // Encrypt and store client-side
                const encrypted = await encryptFile(file);
                files.set(file.name, { encrypted, time: Date.now(), serverFilename: null });
                console.log('File stored client-side:', file.name);

                // Upload to server
                const formData = new FormData(uploadForm);
                const response = await fetch('', {
                    method: 'POST',
                    body: formData
                });
                const responseData = await response.json();
                if (response.ok && responseData.success) {
                    console.log('File uploaded, server filename:', responseData.filename);
                    files.set(file.name, { 
                        encrypted, 
                        time: Date.now(), 
                        serverFilename: responseData.filename 
                    });
                    fetchFileList(); // Update file list after upload
                    showFeedback(`File uploaded successfully: ${file.name}`);
                    fileInput.value = '';
                } else {
                    console.error('Server upload failed:', responseData.error || await response.text());
                    showFeedback('Server upload failed: ' + (responseData.error || 'Unknown error'), true);
                }
            } catch (err) {
                console.error('Upload error:', err);
                showFeedback('Upload failed: ' + err.message, true);
            }
        });
    }

    // Handle file download
    document.querySelectorAll('.open-btn').forEach(button => {
        button.addEventListener('click', handleDownload);
    });

    // Start polling for file list updates
    fetchFileList(); // Initial fetch
    let pollInterval = setInterval(fetchFileList, 3000); // Poll every 3 seconds

    // Pause polling when tab is inactive
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(pollInterval);
            console.log('Paused polling: tab inactive');
        } else {
            pollInterval = setInterval(fetchFileList, 3000);
            fetchFileList();
            console.log('Resumed polling: tab active');
        }
    });

    // Start expiration countdown
    setInterval(updateExpirationCountdown, 1000); // Update every second
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
