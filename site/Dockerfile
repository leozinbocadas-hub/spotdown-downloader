# Use a imagem leve do Nginx baseada em Alpine
FROM nginx:alpine

# Copia os arquivos do site para o diretório padrão do Nginx
COPY . /usr/share/nginx/html

# Expõe a porta 80
EXPOSE 80

# O Nginx inicia automaticamente, então não precisamos de um CMD customizado
