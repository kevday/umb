-- O papel da aplicação precisa poder assumir app_reader (SET LOCAL ROLE). Se o app usar outro usuário: GRANT app_reader TO <usuario>;
GRANT app_reader TO CURRENT_USER;
