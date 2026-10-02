FROM nginx:alpine
COPY index.html app.js calc.js data.js /usr/share/nginx/html/
