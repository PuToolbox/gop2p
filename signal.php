<?php
define('SIGNAL_DIR', './gallery/signals/');
define('EXPIRY_TIME', 300); // 5 minutes, match index.php

// Ensure signals directory exists
if (!is_dir(SIGNAL_DIR)) {
    if (!mkdir(SIGNAL_DIR, 0755, true)) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to create signals directory']);
        exit;
    }
}

// Clean up expired signaling data
function cleanExpiredSignals() {
    $now = time();
    foreach (glob(SIGNAL_DIR . '*.json') as $file) {
        $data = json_decode(file_get_contents($file), true);
        if ($data && ($now - $data['time'] > EXPIRY_TIME)) {
            unlink($file);
        }
    }
}
cleanExpiredSignals();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $peerId = $data['peerId'] ?? '';
    $signalData = $data['signalData'] ?? '';

    if ($peerId && $signalData) {
        $signalFile = SIGNAL_DIR . $peerId . '.json';
        $signalData['time'] = time();
        if (file_put_contents($signalFile, json_encode($signalData, JSON_PRETTY_PRINT), LOCK_EX)) {
            echo json_encode(['success' => true]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to store signaling data']);
        }
    } else {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid request']);
    }
} elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $peerId = $_GET['peerId'] ?? '';
    $signalFile = SIGNAL_DIR . $peerId . '.json';
    if ($peerId && file_exists($signalFile)) {
        $data = json_decode(file_get_contents($signalFile), true);
        if ($data && (time() - $data['time'] <= EXPIRY_TIME)) {
            echo json_encode($data['signalData']);
        } else {
            http_response_code(404);
            echo json_encode(['error' => 'Signal data expired or not found']);
        }
    } else {
        http_response_code(404);
        echo json_encode(['error' => 'Peer not found']);
    }
}
?>