<?php
define('UPLOAD_DIR', './gallery/');
define('METADATA_FILE', UPLOAD_DIR . 'files.json');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $filename = $data['filename'] ?? '';
    $peerId = $data['peerId'] ?? '';

    if ($filename && $peerId) {
        $metadata = json_decode(file_get_contents(METADATA_FILE), true);
        if (isset($metadata[$filename])) {
            $metadata[$filename]['peerId'] = $peerId;
            if (file_put_contents(METADATA_FILE, json_encode($metadata, JSON_PRETTY_PRINT), LOCK_EX)) {
                echo json_encode(['success' => true]);
            } else {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to update metadata']);
            }
        } else {
            http_response_code(404);
            echo json_encode(['error' => 'File not found']);
        }
    } else {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid request']);
    }
}
?>