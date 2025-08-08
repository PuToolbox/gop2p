<?php
// Configuration
define('UPLOAD_DIR', './gallery/');
define('METADATA_FILE', UPLOAD_DIR . 'files.json');
define('KEYS_FILE', UPLOAD_DIR . 'keys.json');
define('MAX_FILE_SIZE', 10 * 1024 * 1024); // 10MB
define('EXPIRY_TIME', 300); // 5 minutes in seconds
define('KEY_ROTATION_INTERVAL', 3600); // 1 hour in seconds

// Debugging: Enable error reporting
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// Ensure upload directory exists
if (!is_dir(UPLOAD_DIR)) {
    if (!mkdir(UPLOAD_DIR, 0755, true)) {
        die('Failed to create gallery directory');
    }
}

// Initialize metadata file
if (!file_exists(METADATA_FILE)) {
    if (!file_put_contents(METADATA_FILE, json_encode([]), LOCK_EX)) {
        die('Failed to create files.json');
    }
}

// Initialize keys file
if (!file_exists(KEYS_FILE)) {
    $initial_key = [
        'key' => base64_encode(openssl_random_pseudo_bytes(32)),
        'created_at' => time()
    ];
    if (!file_put_contents(KEYS_FILE, json_encode(['current' => $initial_key, 'previous' => null], JSON_PRETTY_PRINT), LOCK_EX)) {
        die('Failed to create keys.json');
    }
}

// Load encryption keys
function loadKeys() {
    $keys = json_decode(file_get_contents(KEYS_FILE), true);
    return $keys ?: ['current' => null, 'previous' => null];
}

// Generate new key and rotate
function rotateKey() {
    $keys = loadKeys();
    $now = time();
    
    if (!$keys['current'] || ($now - $keys['current']['created_at'] >= KEY_ROTATION_INTERVAL)) {
        $new_key = [
            'key' => base64_encode(openssl_random_pseudo_bytes(32)),
            'created_at' => $now
        ];
        $keys['previous'] = $keys['current'];
        $keys['current'] = $new_key;
        
        if (!file_put_contents(KEYS_FILE, json_encode($keys, JSON_PRETTY_PRINT), LOCK_EX)) {
            die('Failed to update keys.json');
        }
    }
    
    return $keys;
}

// Get current encryption key
function getCurrentKey() {
    $keys = rotateKey();
    return base64_decode($keys['current']['key']);
}

// Clean up expired files
function cleanExpiredFiles() {
    $now = time();
    $metadata = json_decode(file_get_contents(METADATA_FILE), true);
    $updated_metadata = [];
    
    foreach ($metadata as $filename => $file_info) {
        if ($now - $file_info['time'] <= EXPIRY_TIME) {
            $updated_metadata[$filename] = $file_info;
        } else {
            $filepath = UPLOAD_DIR . $filename;
            if (file_exists($filepath)) {
                unlink($filepath);
            }
        }
    }
    
    if (!file_put_contents(METADATA_FILE, json_encode($updated_metadata, JSON_PRETTY_PRINT), LOCK_EX)) {
        die('Failed to update files.json');
    }
}
cleanExpiredFiles();

// Handle file upload (server fallback)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['file'])) {
    $file = $_FILES['file'];
    if ($file['error'] === UPLOAD_ERR_OK) {
        if ($file['size'] > MAX_FILE_SIZE) {
            $error = 'File size exceeds 10MB limit.';
        } else {
            $allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
            if (!in_array($file['type'], $allowed_types)) {
                $error = 'Invalid file type. Allowed: JPEG, PNG, GIF, PDF.';
            } else {
                $filename = uniqid() . '.enc';
                $filepath = UPLOAD_DIR . $filename;

                $content = file_get_contents($file['tmp_name']);
                $iv = openssl_random_pseudo_bytes(openssl_cipher_iv_length('AES-256-CBC'));
                $encryption_key = getCurrentKey();
                $encrypted = openssl_encrypt($content, 'AES-256-CBC', $encryption_key, 0, $iv);
                if ($encrypted === false) {
                    $error = 'Encryption failed.';
                } else {
                    if (!file_put_contents($filepath, $iv . $encrypted)) {
                        $error = 'Failed to save encrypted file.';
                    } else {
                        $metadata = json_decode(file_get_contents(METADATA_FILE), true);
                        $metadata[$filename] = [
                            'name' => $file['name'],
                            'type' => $file['type'],
                            'time' => time(),
                            'peerId' => null,
                            'key_id' => base64_encode($encryption_key) // Store key ID for tracking
                        ];
                        if (!file_put_contents(METADATA_FILE, json_encode($metadata, JSON_PRETTY_PRINT), LOCK_EX)) {
                            $error = 'Failed to update metadata.';
                        } else {
                            $success = 'File uploaded successfully.';
                        }
                    }
                }
            }
        }
    } else {
        $error = 'Upload error: ' . $file['error'];
    }
}

// Handle file download (server fallback)
if (isset($_GET['download'])) {
    $filename = $_GET['download'];
    $metadata = json_decode(file_get_contents(METADATA_FILE), true);
    if (isset($metadata[$filename]) && file_exists(UPLOAD_DIR . $filename)) {
        $file_info = $metadata[$filename];
        if (time() - $file_info['time'] <= EXPIRY_TIME) {
            $content = file_get_contents(UPLOAD_DIR . $filename);
            $iv_length = openssl_cipher_iv_length('AES-256-CBC');
            $iv = substr($content, 0, $iv_length);
            $encrypted = substr($content, $iv_length);
            
            // Try current and previous keys
            $keys = loadKeys();
            $decrypted = false;
            foreach ([$keys['current'], $keys['previous']] as $key_info) {
                if ($key_info && base64_decode($key_info['key']) === base64_decode($file_info['key_id'])) {
                    $decrypted = openssl_decrypt($encrypted, 'AES-256-CBC', base64_decode($key_info['key']), 0, $iv);
                    if ($decrypted !== false) {
                        break;
                    }
                }
            }
            
            if ($decrypted !== false) {
                header('Content-Type: ' . $file_info['type']);
                header('Content-Disposition: attachment; filename="' . $file_info['name'] . '"');
                echo $decrypted;
                exit;
            } else {
                $error = 'Decryption failed.';
            }
        } else {
            unset($metadata[$filename]);
            file_put_contents(METADATA_FILE, json_encode($metadata, JSON_PRETTY_PRINT), LOCK_EX);
            unlink(UPLOAD_DIR . $filename);
            $error = 'File has expired.';
        }
    } else {
        $error = 'File not found.';
    }
}

// Generate a random nonce for CSP
$nonce = base64_encode(openssl_random_pseudo_bytes(16));
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-Content-Type-Options" content="nosniff">
    <meta http-equiv="X-Frame-Options" content="DENY">
    <meta http-equiv="X-XSS-Protection" content="1; mode=block">
    <meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin">
    <meta http-equiv="Strict-Transport-Security" content="max-age=31536000;">
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; script-src 'self' 'nonce-<?php echo $nonce; ?>'; style-src 'self'; font-src 'self'; img-src 'self';">
    <title>P2P File Transfer Gallery</title>
    <link rel="stylesheet" href="style-8.css">
</head>
<body>
    <div class="container">
        <div class="header">P2P File Transfer Gallery</div>
        <div class="content">
            <?php if (isset($error)): ?>
                <div class="error"><?php echo htmlspecialchars($error); ?></div>
            <?php elseif (isset($success)): ?>
                <div class="success"><?php echo htmlspecialchars($success); ?></div>
            <?php endif; ?>

            <form class="chat-form" id="uploadForm" method="POST" enctype="multipart/form-data">
                <div class="form-group">
                    <input type="file" name="file" id="file" accept="image/jpeg,image/png,image/gif,application/pdf" required>
                </div>
                <div class="button-group">
                    <button type="submit" class="submit-btn">Upload File</button>
                    <button type="button" class="clear-btn" onclick="document.getElementById('file').value = '';">Clear</button>
                </div>
                <hr>
            </form>

            <div class="chat-box" id="fileList">
                <?php
                $metadata = json_decode(file_get_contents(METADATA_FILE), true);
                if (!$metadata || empty($metadata)) {
                    echo '<div class="message">No files available.</div>';
                } else {
                    $now = time();
                    foreach ($metadata as $filename => $file_info) {
                        if ($now - $file_info['time'] <= EXPIRY_TIME) {
                            echo '<div class="message">';
                            echo '<span class="message-name">' . htmlspecialchars($file_info['name']) . '</span>';
                            echo '<span class="message-text">';
                            echo '<a href="?download=' . urlencode($filename) . '" class="open-btn" data-filename="' . urlencode($filename) . '" data-peer-id="' . htmlspecialchars($file_info['peerId'] ?? '') . '">Download</a>';
                            echo ' (Expires in ' . (EXPIRY_TIME - ($now - $file_info['time'])) . ' seconds)';
                            echo '</span>';
                            echo '</div>';
                        } else {
                            unset($metadata[$filename]);
                            if (file_exists(UPLOAD_DIR . $filename)) {
                                unlink(UPLOAD_DIR . $filename);
                            }
                        }
                    }
                    file_put_contents(METADATA_FILE, json_encode($metadata, JSON_PRETTY_PRINT), LOCK_EX);
                }
                ?>
            </div>
        </div>
    </div>

    <script nonce="<?php echo $nonce; ?>" src="gop2p.js"></script>
</body>
</html>