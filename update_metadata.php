<?php
define('UPLOAD_DIR', './gallery/');
define('METADATA_FILE', UPLOAD_DIR . 'files.json');

// Enable error reporting for debugging
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// Log errors to a file for debugging
ini_set('log_errors', 1);
ini_set('error_log', UPLOAD_DIR . 'php_errors.log');

header('Content-Type: application/json');

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        throw new Exception('Invalid request method', 405);
    }

    $data = json_decode(file_get_contents('php://input'), true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        throw new Exception('Invalid JSON: ' . json_last_error_msg(), 400);
    }

    $filename = $data['filename'] ?? '';
    $peerId = $data['peerId'] ?? '';

    if (!$filename || !$peerId) {
        throw new Exception('Missing filename or peerId', 400);
    }

    if (!file_exists(METADATA_FILE)) {
        throw new Exception('Metadata file does not exist', 500);
    }

    if (!is_writable(METADATA_FILE)) {
        throw new Exception('Metadata file is not writable', 500);
    }

    $metadata = json_decode(file_get_contents(METADATA_FILE), true);
    if ($metadata === null) {
        throw new Exception('Failed to parse metadata file: ' . json_last_error_msg(), 500);
    }

    if (!isset($metadata[$filename])) {
        throw new Exception('File not found in metadata', 404);
    }

    $metadata[$filename]['peerId'] = $peerId;
    if (!file_put_contents(METADATA_FILE, json_encode($metadata, JSON_PRETTY_PRINT), LOCK_EX)) {
        throw new Exception('Failed to write metadata file', 500);
    }

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    http_response_code($e->getCode());
    echo json_encode(['error' => $e->getMessage()]);
    error_log('update_metadata.php error: ' . $e->getMessage());
}
?>
