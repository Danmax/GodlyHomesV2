import test from 'node:test';
import assert from 'node:assert/strict';
import { validPodcastLink } from '../shared/podcast-links.js';
import { channelData } from '../server/channels.js';
import { feed } from '../server/feed.js';

test('podcast provider links require the provider’s HTTPS show address', () => {
  assert.equal(validPodcastLink('https://open.spotify.com/show/AbC123?si=share', 'spotify'), true);
  assert.equal(validPodcastLink('https://open.spotify.com/episode/AbC123', 'spotify'), false);
  for (const url of ['https://open.spotify.com.evil.example/show/AbC123', 'https://evil.example/show/AbC123', 'http://open.spotify.com/show/AbC123', 'https://user:password@open.spotify.com/show/AbC123', 'javascript:alert(1)']) assert.equal(validPodcastLink(url, 'spotify'), false);
  assert.equal(validPodcastLink('https://podcasts.apple.com/us/podcast/a-show/id123456', 'apple'), true);
  assert.equal(validPodcastLink('https://podcasts.apple.com.evil.example/us/podcast/id123456', 'apple'), false);
});

test('existing channels need no provider links and RSS ownership uses the current author’s email', () => {
  const legacy = { title: 'My podcast', description: 'A show.', coverUrl: '', coverAlt: 'Cover', authorName: 'Author', authorBio: 'Biography', authorImageUrl: '', authorLink: '', accentColor: '#55644c' };
  const parsed = channelData.parse(legacy);
  assert.equal(parsed.spotifyUrl, ''); assert.equal(parsed.applePodcastsUrl, ''); assert.equal(parsed.rssEmail, '');
  assert.equal(channelData.safeParse({ ...legacy, spotifyUrl: 'https://example.com/not-spotify' }).success, false);
  assert.equal(channelData.safeParse({ ...legacy, rssEmail: 'invalid' }).success, false);
  const xml = feed([], 'https://godlyhomes.com', { ...parsed, rssEmail: 'podcast-owner@example.com', homePath: '/channels/my-podcast', feedPath: '/channels/my-podcast/feed.xml' });
  assert.match(xml, /<itunes:email>podcast-owner@example.com<\/itunes:email>/);
  assert.match(xml, /<itunes:name>Author<\/itunes:name>/);
  assert.match(xml, /https:\/\/godlyhomes.com\/channels\/my-podcast\/feed.xml/);
});
