# Console image: the Angular browser build behind nginx, served at /depot-console/.
# Deployed on its own (deployment repo prod/depot-console, Argo CD app depot-console), like
# stokvel-admin. The build runs in CI before this (npx ng build), so the image only copies files.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/nginx.conf
# Link previews call the public API; the entrypoint writes the cluster's DNS server and this origin
# into /etc/nginx/conf.d/depot-api.conf from the template when the container starts.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    DEPOT_API_ORIGIN=https://fmash.online/depot
COPY nginx-templates/ /etc/nginx/templates/
COPY dist/depot-console/browser/ /usr/share/nginx/html/
EXPOSE 8080
