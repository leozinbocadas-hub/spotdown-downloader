# Use a imagem leve do Nginx baseada em Alpine
FROM nginx:alpine

# Limpa o diretório padrão para evitar arquivos residuais
RUN rm -rf /usr/share/nginx/html/*

# Copia o conteúdo atual para o diretório do Nginx
COPY . /usr/share/nginx/html/

# Expõe a porta 80
EXPOSE 80

