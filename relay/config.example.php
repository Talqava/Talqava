<?php
// Copy this file to ONE FOLDER ABOVE public_html, name it talqava-auth-config.php, and fill it in.
// It must never be inside public_html: it holds the secrets.
//
// For each service: register one app with it in the company's name, give the service this return address
//     https://auth.talqava.com/callback.php
// and paste the app's ID and secret here. Leave out a service until its app exists.
return [
    // The return address registered with every service. It must match exactly.
    'redirect' => 'https://auth.talqava.com/callback.php',

    'services' => [
        // style: how the service wants the secret. "form" is the usual; "basic" and "json" are noted where needed.
        'asana'    => ['client_id' => '', 'client_secret' => '', 'token_url' => 'https://app.asana.com/-/oauth_token'],
        'hubspot'  => ['client_id' => '', 'client_secret' => '', 'token_url' => 'https://api.hubapi.com/oauth/v1/token'],
        'typeform' => ['client_id' => '', 'client_secret' => '', 'token_url' => 'https://api.typeform.com/oauth/token'],
        'todoist'  => ['client_id' => '', 'client_secret' => '', 'token_url' => 'https://api.todoist.com/oauth/access_token'],
        'clickup'  => ['client_id' => '', 'client_secret' => '', 'token_url' => 'https://api.clickup.com/api/v2/oauth/token'],
        'mailchimp' => ['client_id' => '', 'client_secret' => '', 'token_url' => 'https://login.mailchimp.com/oauth2/token'],
        'slack'    => ['client_id' => '', 'client_secret' => '', 'token_url' => 'https://slack.com/api/oauth.v2.access'],
        // Calendly wants the app's ID in the form as well as in the header.
        'calendly' => ['client_id' => '', 'client_secret' => '', 'token_url' => 'https://auth.calendly.com/oauth/token', 'style' => 'basic_with_id'],
        'klaviyo'  => ['client_id' => '', 'client_secret' => '', 'token_url' => 'https://a.klaviyo.com/oauth/token', 'style' => 'basic'],
        'jira'     => ['client_id' => '', 'client_secret' => '', 'token_url' => 'https://auth.atlassian.com/oauth/token', 'style' => 'json'],
        // Pipedrive names the address to use for each company in its answer; the app needs it passed on.
        'pipedrive' => ['client_id' => '', 'client_secret' => '', 'token_url' => 'https://oauth.pipedrive.com/oauth/token', 'style' => 'basic', 'pass' => ['api_domain']],
    ],
];
