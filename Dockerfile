# Console image: the Angular browser build behind nginx, served at /depot-console/.
# Deployed on its own (deployment repo prod/depot-console, Argo CD app depot-console), like
# stokvel-admin. The build runs in CI before this (npx ng build), so the image only copies files.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY dist/depot-console/browser/ /usr/share/nginx/html/
EXPOSE 8080
