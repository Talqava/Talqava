<?php
// Renews a sign-in that is running out. Called by the Talqava app on the owner's computer.
declare(strict_types=1);
require __DIR__ . '/lib.php';

$config = settings();
$in = sent();
$s = service($config, $in['service'] ?? null);
$token = text($in['refresh_token'] ?? '');
if ($token === '') {
    answer(400, ['error' => 'There is nothing to renew.']);
}
$fields = ['grant_type' => 'refresh_token', 'refresh_token' => $token];
if (!empty($s['refresh_with_redirect'])) {
    $fields['redirect_uri'] = (string) $config['redirect'];
}
exchange($s, tokenAddress($s, $in['asked'] ?? null), $fields);
