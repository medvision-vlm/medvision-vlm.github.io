---
layout: default
title: Blog
---

## 📝 Blog

Stories behind the MedVision project: from dataset releases to leaderboard updates.

<ol class="mv-blog-list">
{% for post in site.posts %}
  <li class="mv-blog-card">
    <a class="mv-blog-link" href="{{ post.url | relative_url }}">
      <time class="mv-blog-date" datetime="{{ post.date | date: '%Y-%m-%d' }}">{{ post.date | date: '%b %-d, %Y' }}</time>
      <span class="mv-blog-title">{{ post.title }}</span>
      <span class="mv-blog-teaser">{{ post.description }}</span>
      <span class="mv-blog-read">Read post <i class="fas fa-arrow-right"></i></span>
    </a>
  </li>
{% endfor %}
</ol>
