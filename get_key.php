<?php
define('UPLOAD_DIR', './gallery/');
define('KEYS_FILE', UPLOAD_DIR . 'keys.json');
define('KEY_ROTATION_INTERVAL', 3600); // 1 hour in seconds

// Load encryption keys
function loadKeys() {
    $keys = json_decode(file_get_contents(KEYS_FILE), true);
    return $keys ?: ['current' => null, 'previous' => null];
}

// Rotate key if needed
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
            http_response_code(500);
            echo json_encode(['error' => 'Failed to update keys']);
            exit;
        }
    }
    
    return $keys;
}

$keys = rotateKey();
header('Content-Type: application/json');
echo json_encode([
    'current_key' => $keys['current']['key'],
    'previous_key' => $keys['previous'] ? $keys['previous']['key'] : null
]);
?>