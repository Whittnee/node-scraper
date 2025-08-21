FROM alpine:3.19
RUN apk add --no-cache nodejs npm nginx bash curl ca-certificates tini && \
    mkdir -p /run/nginx /var/www/site /scrapper /etc/nginx/conf.d

WORKDIR /scrapper

COPY package.json  ./
RUN npm install --production

COPY scraper.js ./scraper.js
RUN sed -i 's/\r$//' /scrapper/scraper.js \
 && chmod +x /scrapper/scraper.js \
 && ln -sf /scrapper/scraper.js /usr/local/bin/scraper

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/site.conf  /etc/nginx/conf.d/site.conf

EXPOSE 8088
ENTRYPOINT ["/sbin/tini","--"]
CMD ["/bin/sh","-lc","nginx -g 'daemon off;'"]