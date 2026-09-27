# ZAP Scanning Report

ZAP by [Checkmarx](https://checkmarx.com/).


## Summary of Alerts

| Risk Level | Number of Alerts |
| --- | --- |
| High | 0 |
| Medium | 1 |
| Low | 2 |
| Informational | 4 |




## Insights

| Level | Reason | Site | Description | Statistic |
| --- | --- | --- | --- | --- |
| Low | Warning |  | ZAP warnings logged - see the zap.log file for details | 6    |
| Info | Informational | https://drms-kas.staging.bimacreative.tech | Percentage of responses with status code 2xx | 79 % |
| Info | Informational | https://drms-kas.staging.bimacreative.tech | Percentage of responses with status code 3xx | 2 % |
| Info | Informational | https://drms-kas.staging.bimacreative.tech | Percentage of responses with status code 4xx | 17 % |
| Info | Informational | https://drms-kas.staging.bimacreative.tech | Percentage of endpoints with content type application/javascript | 40 % |
| Info | Informational | https://drms-kas.staging.bimacreative.tech | Percentage of endpoints with content type font/woff2 | 7 % |
| Info | Informational | https://drms-kas.staging.bimacreative.tech | Percentage of endpoints with content type image/png | 7 % |
| Info | Informational | https://drms-kas.staging.bimacreative.tech | Percentage of endpoints with content type text/css | 18 % |
| Info | Informational | https://drms-kas.staging.bimacreative.tech | Percentage of endpoints with content type text/html | 18 % |
| Info | Informational | https://drms-kas.staging.bimacreative.tech | Percentage of endpoints with content type text/plain | 3 % |
| Info | Informational | https://drms-kas.staging.bimacreative.tech | Percentage of endpoints with method GET | 100 % |
| Info | Informational | https://drms-kas.staging.bimacreative.tech | Count of total endpoints | 27    |
| Info | Informational | https://drms-kas.staging.bimacreative.tech | Percentage of slow responses | 58 % |







## Alerts

| Name | Risk Level | Number of Instances |
| --- | --- | --- |
| CSP: style-src unsafe-inline | Medium | Systemic |
| Cross-Origin-Embedder-Policy Header Missing or Invalid | Low | 2 |
| Cross-Origin-Resource-Policy Header Missing or Invalid | Low | Systemic |
| Content-Type Header Missing | Informational | 1 |
| Modern Web Application | Informational | Systemic |
| Non-Storable Content | Informational | 5 |
| Storable and Cacheable Content | Informational | 5 |




## Alert Detail



### [ CSP: style-src unsafe-inline ](https://www.zaproxy.org/docs/alerts/10055/)



##### Medium (High)

### Description

Content Security Policy (CSP) is an added layer of security that helps to detect and mitigate certain types of attacks. Including (but not limited to) Cross Site Scripting (XSS), and data injection attacks. These attacks are used for everything from data theft to site defacement or distribution of malware. CSP provides a set of standard HTTP headers that allow website owners to declare approved sources of content that browsers should be allowed to load on that page — covered types are JavaScript, CSS, HTML frames, fonts, images and embeddable objects such as Java applets, ActiveX, audio and video files.

* URL: https://drms-kas.staging.bimacreative.tech/
  * Node Name: `https://drms-kas.staging.bimacreative.tech/`
  * Method: `GET`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `default-src 'self'; script-src 'self' 'nonce-lTgesXa/DyJ1hKr5Zo0DKw=='; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://auth.bimacreative.tech; frame-ancestors 'none'`
  * Other Info: `style-src includes unsafe-inline.`
* URL: https://drms-kas.staging.bimacreative.tech/
  * Node Name: `https://drms-kas.staging.bimacreative.tech/`
  * Method: `GET`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `default-src 'self'; script-src 'self' 'nonce-sI2Ln5SNAdaKOEjTTCYOOw=='; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://auth.bimacreative.tech; frame-ancestors 'none'`
  * Other Info: `style-src includes unsafe-inline.`
* URL: https://drms-kas.staging.bimacreative.tech/admin/login
  * Node Name: `https://drms-kas.staging.bimacreative.tech/admin/login`
  * Method: `GET`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `default-src 'self'; script-src 'self' 'nonce-EWoW1RmKdePPmDqbFhrPRw=='; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://auth.bimacreative.tech; frame-ancestors 'none'`
  * Other Info: `style-src includes unsafe-inline.`
* URL: https://drms-kas.staging.bimacreative.tech/admin/login
  * Node Name: `https://drms-kas.staging.bimacreative.tech/admin/login`
  * Method: `GET`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `default-src 'self'; script-src 'self' 'nonce-VHYPaEWxGqY0MmrO4YGEzw=='; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://auth.bimacreative.tech; frame-ancestors 'none'`
  * Other Info: `style-src includes unsafe-inline.`
* URL: https://drms-kas.staging.bimacreative.tech/robots.txt
  * Node Name: `https://drms-kas.staging.bimacreative.tech/robots.txt`
  * Method: `GET`
  * Parameter: `Content-Security-Policy`
  * Attack: ``
  * Evidence: `default-src 'self'; script-src 'self' 'nonce-rzMGZyiu2gchZseI6VtWtw=='; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://auth.bimacreative.tech; frame-ancestors 'none'`
  * Other Info: `style-src includes unsafe-inline.`

Instances: Systemic


### Solution

Ensure that your web server, application server, load balancer, etc. is properly configured to set the Content-Security-Policy header.

### Reference


* [ https://www.w3.org/TR/CSP/ ](https://www.w3.org/TR/CSP/)
* [ https://caniuse.com/#search=content+security+policy ](https://caniuse.com/#search=content+security+policy)
* [ https://content-security-policy.com/ ](https://content-security-policy.com/)
* [ https://github.com/HtmlUnit/htmlunit-csp ](https://github.com/HtmlUnit/htmlunit-csp)
* [ https://web.dev/articles/csp#resource-options ](https://web.dev/articles/csp#resource-options)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 15

#### Source ID: 3

### [ Cross-Origin-Embedder-Policy Header Missing or Invalid ](https://www.zaproxy.org/docs/alerts/90004/)



##### Low (Medium)

### Description

Cross-Origin-Embedder-Policy header is a response header that prevents a document from loading any cross-origin resources that don't explicitly grant the document permission (using CORP or CORS).

* URL: https://drms-kas.staging.bimacreative.tech/admin/login
  * Node Name: `https://drms-kas.staging.bimacreative.tech/admin/login`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://drms-kas.staging.bimacreative.tech/admin/login%3Fredirect=%252Fadmin
  * Node Name: `https://drms-kas.staging.bimacreative.tech/admin/login (redirect)`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``


Instances: 2

### Solution

Ensure that the application/web server sets the Cross-Origin-Embedder-Policy header appropriately, and that it sets the Cross-Origin-Embedder-Policy header to 'require-corp' for documents.
If possible, ensure that the end user uses a standards-compliant and modern web browser that supports the Cross-Origin-Embedder-Policy header (https://caniuse.com/mdn-http_headers_cross-origin-embedder-policy).

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 14

#### Source ID: 3

### [ Cross-Origin-Resource-Policy Header Missing or Invalid ](https://www.zaproxy.org/docs/alerts/90004/)



##### Low (Medium)

### Description

Cross-Origin-Resource-Policy header is an opt-in header designed to counter side-channels attacks like Spectre. Resource should be specifically set as shareable amongst different origins.

* URL: https://drms-kas.staging.bimacreative.tech/_next/static/chunks/main-app-0a97dfecc7f2bf9f.js
  * Node Name: `https://drms-kas.staging.bimacreative.tech/_next/static/chunks/main-app-0a97dfecc7f2bf9f.js`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://drms-kas.staging.bimacreative.tech/_next/static/chunks/webpack-abf8c849786b87a7.js
  * Node Name: `https://drms-kas.staging.bimacreative.tech/_next/static/chunks/webpack-abf8c849786b87a7.js`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://drms-kas.staging.bimacreative.tech/_next/static/media/13971731025ec697-s.p.woff2
  * Node Name: `https://drms-kas.staging.bimacreative.tech/_next/static/media/13971731025ec697-s.p.woff2`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://drms-kas.staging.bimacreative.tech/_next/static/media/36966cca54120369-s.p.woff2
  * Node Name: `https://drms-kas.staging.bimacreative.tech/_next/static/media/36966cca54120369-s.p.woff2`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://drms-kas.staging.bimacreative.tech/admin/login
  * Node Name: `https://drms-kas.staging.bimacreative.tech/admin/login`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``

Instances: Systemic


### Solution

Ensure that the application/web server sets the Cross-Origin-Resource-Policy header appropriately, and that it sets the Cross-Origin-Resource-Policy header to 'same-origin' for all web pages.
'same-site' is considered as less secured and should be avoided.
If resources must be shared, set the header to 'cross-origin'.
If possible, ensure that the end user uses a standards-compliant and modern web browser that supports the Cross-Origin-Resource-Policy header (https://caniuse.com/mdn-http_headers_cross-origin-resource-policy).

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 14

#### Source ID: 3

### [ Content-Type Header Missing ](https://www.zaproxy.org/docs/alerts/10019/)



##### Informational (Medium)

### Description

The Content-Type header was either missing or empty.

* URL: https://drms-kas.staging.bimacreative.tech/admin
  * Node Name: `https://drms-kas.staging.bimacreative.tech/admin`
  * Method: `GET`
  * Parameter: `content-type`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``


Instances: 1

### Solution

Ensure each page is setting the specific and appropriate content-type value for the content being delivered.

### Reference


* [ https://learn.microsoft.com/en-us/previous-versions/windows/internet-explorer/ie-developer/compatibility/gg622941(v=vs.85) ](https://learn.microsoft.com/en-us/previous-versions/windows/internet-explorer/ie-developer/compatibility/gg622941(v=vs.85))


#### CWE Id: [ 345 ](https://cwe.mitre.org/data/definitions/345.html)


#### WASC Id: 12

#### Source ID: 3

### [ Modern Web Application ](https://www.zaproxy.org/docs/alerts/10109/)



##### Informational (Medium)

### Description

The application appears to be a modern web application. If you need to explore it automatically then the Client Spider may well be more effective than the standard one.

* URL: https://drms-kas.staging.bimacreative.tech/
  * Node Name: `https://drms-kas.staging.bimacreative.tech/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script src="/_next/static/chunks/87c73c54-fe9448718f10265c.js" async=""></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`
* URL: https://drms-kas.staging.bimacreative.tech/admin/login
  * Node Name: `https://drms-kas.staging.bimacreative.tech/admin/login`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script src="/_next/static/chunks/87c73c54-fe9448718f10265c.js" async="" nonce="EWoW1RmKdePPmDqbFhrPRw=="></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`
* URL: https://drms-kas.staging.bimacreative.tech/admin/login
  * Node Name: `https://drms-kas.staging.bimacreative.tech/admin/login`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script src="/_next/static/chunks/87c73c54-fe9448718f10265c.js" async="" nonce="VHYPaEWxGqY0MmrO4YGEzw=="></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`
* URL: https://drms-kas.staging.bimacreative.tech/robots.txt
  * Node Name: `https://drms-kas.staging.bimacreative.tech/robots.txt`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script src="/_next/static/chunks/87c73c54-fe9448718f10265c.js" async=""></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`
* URL: https://drms-kas.staging.bimacreative.tech/sitemap.xml
  * Node Name: `https://drms-kas.staging.bimacreative.tech/sitemap.xml`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script src="/_next/static/chunks/87c73c54-fe9448718f10265c.js" async=""></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`

Instances: Systemic


### Solution

This is an informational alert and so no changes are required.

### Reference




#### Source ID: 3

### [ Non-Storable Content ](https://www.zaproxy.org/docs/alerts/10049/)



##### Informational (Medium)

### Description

The response contents are not storable by caching components such as proxy servers. If the response does not contain sensitive, personal or user-specific information, it may benefit from being stored and cached, to improve performance.

* URL: https://drms-kas.staging.bimacreative.tech/
  * Node Name: `https://drms-kas.staging.bimacreative.tech/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: https://drms-kas.staging.bimacreative.tech/admin
  * Node Name: `https://drms-kas.staging.bimacreative.tech/admin`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: https://drms-kas.staging.bimacreative.tech/admin/login
  * Node Name: `https://drms-kas.staging.bimacreative.tech/admin/login`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: https://drms-kas.staging.bimacreative.tech/robots.txt
  * Node Name: `https://drms-kas.staging.bimacreative.tech/robots.txt`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: https://drms-kas.staging.bimacreative.tech/sitemap.xml
  * Node Name: `https://drms-kas.staging.bimacreative.tech/sitemap.xml`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``


Instances: 5

### Solution

The content may be marked as storable by ensuring that the following conditions are satisfied:
The request method must be understood by the cache and defined as being cacheable ("GET", "HEAD", and "POST" are currently defined as cacheable)
The response status code must be understood by the cache (one of the 1XX, 2XX, 3XX, 4XX, or 5XX response classes are generally understood)
The "no-store" cache directive must not appear in the request or response header fields
For caching by "shared" caches such as "proxy" caches, the "private" response directive must not appear in the response
For caching by "shared" caches such as "proxy" caches, the "Authorization" header field must not appear in the request, unless the response explicitly allows it (using one of the "must-revalidate", "public", or "s-maxage" Cache-Control response directives)
In addition to the conditions above, at least one of the following conditions must also be satisfied by the response:
It must contain an "Expires" header field
It must contain a "max-age" response directive
For "shared" caches such as "proxy" caches, it must contain a "s-maxage" response directive
It must contain a "Cache Control Extension" that allows it to be cached
It must have a status code that is defined as cacheable by default (200, 203, 204, 206, 300, 301, 404, 405, 410, 414, 501).

### Reference


* [ https://datatracker.ietf.org/doc/html/rfc7234 ](https://datatracker.ietf.org/doc/html/rfc7234)
* [ https://datatracker.ietf.org/doc/html/rfc7231 ](https://datatracker.ietf.org/doc/html/rfc7231)
* [ https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html ](https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html)


#### CWE Id: [ 524 ](https://cwe.mitre.org/data/definitions/524.html)


#### WASC Id: 13

#### Source ID: 3

### [ Storable and Cacheable Content ](https://www.zaproxy.org/docs/alerts/10049/)



##### Informational (Medium)

### Description

The response contents are storable by caching components such as proxy servers, and may be retrieved directly from the cache, rather than from the origin server by the caching servers, in response to similar requests from other users. If the response data is sensitive, personal or user-specific, this may result in sensitive information being leaked. In some cases, this may even result in a user gaining complete control of the session of another user, depending on the configuration of the caching components in use in their environment. This is primarily an issue where "shared" caching servers such as "proxy" caches are configured on the local network. This configuration is typically found in corporate or educational environments, for instance.

* URL: https://drms-kas.staging.bimacreative.tech/_next/static/chunks/main-app-0a97dfecc7f2bf9f.js
  * Node Name: `https://drms-kas.staging.bimacreative.tech/_next/static/chunks/main-app-0a97dfecc7f2bf9f.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `max-age=31536000`
  * Other Info: ``
* URL: https://drms-kas.staging.bimacreative.tech/_next/static/chunks/webpack-abf8c849786b87a7.js
  * Node Name: `https://drms-kas.staging.bimacreative.tech/_next/static/chunks/webpack-abf8c849786b87a7.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `max-age=31536000`
  * Other Info: ``
* URL: https://drms-kas.staging.bimacreative.tech/_next/static/css/e5d1b6185968e333.css
  * Node Name: `https://drms-kas.staging.bimacreative.tech/_next/static/css/e5d1b6185968e333.css`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `max-age=31536000`
  * Other Info: ``
* URL: https://drms-kas.staging.bimacreative.tech/_next/static/media/13971731025ec697-s.p.woff2
  * Node Name: `https://drms-kas.staging.bimacreative.tech/_next/static/media/13971731025ec697-s.p.woff2`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `max-age=31536000`
  * Other Info: ``
* URL: https://drms-kas.staging.bimacreative.tech/_next/static/media/36966cca54120369-s.p.woff2
  * Node Name: `https://drms-kas.staging.bimacreative.tech/_next/static/media/36966cca54120369-s.p.woff2`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `max-age=31536000`
  * Other Info: ``


Instances: 5

### Solution

Validate that the response does not contain sensitive, personal or user-specific information. If it does, consider the use of the following HTTP response headers, to limit, or prevent the content being stored and retrieved from the cache by another user:
Cache-Control: no-cache, no-store, must-revalidate, private
Pragma: no-cache
Expires: 0
This configuration directs both HTTP 1.0 and HTTP 1.1 compliant caching servers to not store the response, and to not retrieve the response (without validation) from the cache, in response to a similar request.

### Reference


* [ https://datatracker.ietf.org/doc/html/rfc7234 ](https://datatracker.ietf.org/doc/html/rfc7234)
* [ https://datatracker.ietf.org/doc/html/rfc7231 ](https://datatracker.ietf.org/doc/html/rfc7231)
* [ https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html ](https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html)


#### CWE Id: [ 524 ](https://cwe.mitre.org/data/definitions/524.html)


#### WASC Id: 13

#### Source ID: 3


