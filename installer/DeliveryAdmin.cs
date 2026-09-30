/*
 * DeliveryAdmin: instalador, atalho e programa de partida.
 *
 * UM .EXE, TRES MODOS
 *
 * Sem argumento, abre a tela de instalacao com as cores do painel. Com
 * `--instalar`, instala sem perguntar nada (e' o que o instalador de arquivo unico
 * chama depois de extrair). Com `--desinstalar`, remove. Com `--iniciar`, sobe o
 * servidor e abre o navegador -- esse e' o que o atalho do Menu Iniciar faz.
 *
 * POR QUE C# E NAO UM SCRIPT
 *
 * Porque o Windows ja traz o compilador: `csc.exe`, dentro do .NET Framework, em
 * toda maquina desde o Windows XP. Nao ha nada para baixar, e o resultado e' um
 * `.exe` de verdade, com icone, atalho e entrada em "Apps installed". Um `.bat`
 * que abre uma janela preta e escreve `copy /Y` nao passa por programa instalado
 * para ninguem -- e a pessoa que esta instalando nao sabe se pode fechar a
 * janela.
 *
 * POR QUE NAO NSIS, INNO SETUP OU WIX
 *
 * Porque os tres precisam ser baixados, e um instalador que depende de um
 * programa de terceiros e' um instalador que quebra na maquina do cliente. As
 * tres coisas que este faz -- copiar arquivo, criar atalho, registrar no
 * Painel -- o Windows sabe fazer sozinho, via registro e IShellLink.
 *
 * O QUE ESTE NAO FAZ
 *
 * Nao pede senha, nao pede cartao e nao abre o navegador para "ativar". O
 * sistema inteiro e' local e nao sai da maquina do dono; a unica coisa que ele
 * usa e' a conta de e-mail e senha que ele mesmo cria na primeira tela.
 */

using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace DeliveryAdmin
{
    internal static class Cores
    {
        // Tokens Straight do :root do src/styles/app.css. Copiar a paleta de
        // mao e' o jeito de ela divergir: o proximo que mudar o acento do painel
        // esquece de mudar aqui, e o instalador fica com a cara de outro produto.
        public static readonly Color Fundo = Hex(0xFA, 0xF9, 0xF7);
        public static readonly Color Cartao = Color.White;
        public static readonly Color Superficie2 = Hex(0xF5, 0xF4, 0xF2);
        public static readonly Color Borda = Hex(0xE7, 0xE3, 0xDE);
        public static readonly Color Texto1 = Hex(0x1C, 0x19, 0x17);
        public static readonly Color Texto2 = Hex(0x57, 0x53, 0x4E);
        public static readonly Color Texto3 = Hex(0x72, 0x6C, 0x65);
        public static readonly Color Acento = Hex(0xB4, 0x53, 0x09);
        public static readonly Color AcentoForte = Hex(0x92, 0x40, 0x0E);
        public static readonly Color Sucesso = Hex(0x04, 0x78, 0x5A);
        public static readonly Color Erro = Hex(0xA8, 0x1F, 0x1F);
        public static readonly Color ErroFundo = Hex(0xFD, 0xEC, 0xEC);
        public static readonly Color AvisoFundo = Hex(0xFD, 0xF4, 0xE3);

        // Os raios do design system: 8 no input, 10 no botao, 14 no cartao.
        public const int RaioInput = 8;
        public const int RaioBotao = 10;
        public const int RaioCartao = 14;

        private static Color Hex(int r, int g, int b)
        {
            return Color.FromArgb(r, g, b);
        }
    }

    /// <summary>Arredonda os cantos de um controle. WinForms nao faz isso sozinho.</summary>
    internal static class Cantos
    {
        public static void Aplica(Control c, int raio)
        {
            using (GraphicsPath caminho = new GraphicsPath())
            {
                int d = raio * 2;
                caminho.AddArc(0, 0, d, d, 180, 90);
                caminho.AddArc(c.Width - d, 0, d, d, 270, 90);
                caminho.AddArc(c.Width - d, c.Height - d, d, d, 0, 90);
                caminho.AddArc(0, c.Height - d, d, d, 90, 90);
                caminho.CloseFigure();
                c.Region = new Region(caminho);
            }
        }
    }

    /// <summary>Botao com as cores e o raio do design system.</summary>
    internal sealed class Botao : Button
    {
        private readonly bool _primario;
        private bool _hover;

        public Botao(string texto, bool primario)
        {
            _primario = primario;
            Text = texto;
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            Font = new Font("Segoe UI", 10F, FontStyle.Bold);
            Height = 40;
            Cursor = Cursors.Hand;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Color fundo = !Enabled
                ? (_primario ? Cores.Acento : Cores.Superficie2)
                : _primario
                    ? (_hover ? Cores.AcentoForte : Cores.Acento)
                    : (_hover ? Cores.Superficie2 : Cores.Cartao);

            using (GraphicsPath p = new GraphicsPath())
            {
                int d = Cores.RaioBotao * 2;
                p.AddArc(0, 0, d, d, 180, 90);
                p.AddArc(Width - d, 0, d, d, 270, 90);
                p.AddArc(Width - d, Height - d, d, d, 0, 90);
                p.AddArc(0, Height - d, d, d, 90, 90);
                p.CloseFigure();
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                using (SolidBrush b = new SolidBrush(fundo)) e.Graphics.FillPath(b, p);
            }

            TextRenderer.DrawText(
                e.Graphics, Text, Font, ClientRectangle,
                Enabled ? (_primario ? Color.White : Cores.Texto1) : Cores.Texto3,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter
            );
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            _hover = true;
            Invalidate();
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            _hover = false;
            Invalidate();
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            // O Region e' recalculado com o tamanho antigo depois de um resize, e
            // o botao fica com o canto torto ate o proximo redesenho.
            if (Width > 0 && Height > 0)
            {
                using (GraphicsPath p = new GraphicsPath())
                {
                    int d = Cores.RaioBotao * 2;
                    p.AddArc(0, 0, d, d, 180, 90);
                    p.AddArc(Width - d, 0, d, d, 270, 90);
                    p.AddArc(Width - d, Height - d, d, d, 0, 90);
                    p.AddArc(0, Height - d, d, d, 90, 90);
                    p.CloseFigure();
                    Region = new Region(p);
                }
            }
        }
    }

    /// <summary>
    /// A janela que aparece enquanto o programa e' descompactado.
    ///
    /// Existe porque a extracao leva um minuto e meio e a alternativa -- ficar sem
    /// janela nenhuma -- faz o dono clicar de novo. Sem barra de porcentagem
    /// exata, e' um aviso honesto: "leva um minuto, nao feche". Barra que mente
    /// sobre quanto falta e' pior do que barra nenhuma.
    /// </summary>
    internal sealed class JanelaProgresso : Form
    {
        private readonly Panel _cartao;
        private readonly Panel _barra;
        private readonly Label _titulo;
        private readonly Label _detalhe;

        public JanelaProgresso(int total)
        {
            Text = "DeliveryAdmin";
            ClientSize = new Size(520, 200);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Cores.Fundo;
            Font = new Font("Segoe UI", 9.5F);
            DoubleBuffered = true;
            ControlBox = false;

            _cartao = new Panel { Bounds = new Rectangle(24, 22, 472, 108), BackColor = Cores.Cartao };
            Cantos.Aplica(_cartao, Cores.RaioCartao);
            Controls.Add(_cartao);

            _titulo = new Label
            {
                Text = "Preparando",
                Font = new Font("Segoe UI", 15F, FontStyle.Bold),
                ForeColor = Cores.Texto1,
                Bounds = new Rectangle(26, 24, 420, 26)
            };
            _cartao.Controls.Add(_titulo);

            // Barra sem porcentagem: uma faixa que anda e volta, que e' o que o
            // Windows usa quando nao sabe quanto falta. E' o honesto aqui.
            _barra = new Panel { Bounds = new Rectangle(26, 60, 420, 6), BackColor = Cores.Superficie2 };
            _cartao.Controls.Add(_barra);

            // A posicao do ponto e' um campo, e nao uma variavel local do
            // tratamento de evento: o `Paint` e' disparado pelo Windows, e uma
            // variavel capturada ali seria recriada a cada desenho -- a bolinha
            // voltaria para o comeco e a barra pareceria travada.
            int[] x = { -14 };
            _barra.Paint += delegate(object s, PaintEventArgs e)
            {
                using (SolidBrush b = new SolidBrush(Cores.Acento))
                {
                    e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    e.Graphics.FillEllipse(b, x[0], -3, 12, 12);
                }
            };

            // Windows.Forms.Timer e nao Threading.Timer: os dois se chamam Timer e os dois estao
            // importados. O do Windows Forms e' o que roda na thread da interface, que e' o
            // unico que pode desenhar.
            System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
            t.Interval = 24;
            t.Tick += delegate
            {
                x[0] += 6;
                if (x[0] > _barra.Width) x[0] = -14;
                _barra.Invalidate();
            };
            t.Start();
            // Sem `FormClosed`, o timer continua vivo depois da janela fechar e
            // o processo nao termina -- o instalador ficaria aberto no gerenciador
            // de tarefas depois de instalar.
            FormClosed += delegate { t.Stop(); t.Dispose(); };

            _detalhe = new Label
            {
                Text = "Sao cerca de 100 MB. Leva um minuto ou dois -- nao feche esta janela.",
                ForeColor = Cores.Texto2,
                Bounds = new Rectangle(26, 78, 420, 20)
            };
            _cartao.Controls.Add(_detalhe);

            Resize += delegate(object s, EventArgs ev) { Cantos.Aplica(_cartao, Cores.RaioCartao); };
        }

        public void Informar(string texto)
        {
            _titulo.Text = texto;
        }

        public void Fechar()
        {
            try
            {
                if (!IsDisposed) Close();
            }
            catch { }
        }
    }

    internal static class Programa
    {
        public const string Nome = "DeliveryAdmin";
        public const string Versao = "1.0.0";

        internal static string PastaPrograma
        {
            get
            {
                if (_destino != null) return _destino;
                string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
                return Path.Combine(pf, Nome);
            }
        }

        /// <summary>
        /// Instalar em outro lugar, sem pedir administrador.
        ///
        /// Duas coisas que isso resolve. A primeira e' o teste: `Program Files`
        /// exige o clique no "Sim" do UAC, e um instalador que so pode ser
        /// verificado por quem consegue clicar no UAC nunca chega a um PC limpo.
        /// A segunda e' um caso real -- install em uma pasta chosen, em rede ou
        /// em pen drive, para quem nao quer instalar nada em `C:\Program Files`.
        /// </summary>
        private static string _destino;

        public static void DefineDestino(string pasta)
        {
            if (string.IsNullOrEmpty(pasta)) return;
            _destino = Path.GetFullPath(pasta);
        }

        internal static string PastaDados
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), Nome); }
        }

        internal static string PastaMenu
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Nome); }
        }

        [STAThread]
        private static void Main(string[] args)
        {
            string modo = args.Length > 0 ? args[0].ToLowerInvariant() : "";

            // `--destino <pasta>` vem antes de tudo: e' o que permite instalar
            // fora de `Program Files`, e por isso sem UAC.
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i].Equals("--destino", StringComparison.OrdinalIgnoreCase))
                {
                    DefineDestino(args[i + 1]);
                }
            }

            // A versao distribuida vem dentro de um ZIP: o `programa.zip` esta
            // ao lado deste .exe, e ele ainda nao se descompactou. Quando e' esse
            // o caso, descomprime e so depois continua -- para que quem recebeu
            // o ZIP tenha um unico duplo clique e nao precise saber qual dos dois
            // arquivos apertar.
            if (modo != "--instalar-bruto" && !File.Exists(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "dist", "server.js")))
            {
                string zip = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "programa.zip");
                if (File.Exists(zip) && Descompacta(zip, AppDomain.CurrentDomain.BaseDirectory))
                {
                    modo = "--instalar";
                }
            }

            // Windows Forms em DPI alto sem isto fica com a janela do tamanho
            // errado, e o botao de fechar some.
            try { EnableHighDpi(); } catch { }

            try
            {
                switch (modo)
                {
                    case "--instalar":
                        Instalador.InstalaSilencioso();
                        return;
                    case "--pos-instalacao":
                    {
                        /*
                         * Os parametros vem nesta ordem:
                         *   --pos-instalacao --destino "<pasta>" [--iniciar-sozinho]
                         *
                         * A opcao do Inno e' procurada em TODOS os argumentos, e
                         * nao em `args[1]`. Com o `--destino` no meio, `args[1]`
                         * e' sempre o caminho, entao a opcao de abrir o painel
                         * junto com o Windows era silenciosamente ignorada -- e o
                         * sintoma era "instalei, mas nada abriu", que e' exatamente
                         * a duvida que o dono nao consegue resolver sozinho.
                         */
                        bool sozinho = false;
                        for (int i = 0; i < args.Length; i++)
                        {
                            if (args[i].Equals("--iniciar-sozinho", StringComparison.OrdinalIgnoreCase))
                            {
                                sozinho = true;
                            }
                        }

                        // O log e' ligado aqui porque este modo roda com a janela
                        // fechada, por tras do instalador. Sem isto, a unica pista
                        // de uma falha e' a barra de progresso que parou de andar,
                        // e o log continuaria com a mensagem da instalacao antiga.
                        string arquivoPos = Instalador.LogDeInstalacao();
                        Instalador.Log = delegate(string s) { Instalador.EscreveNoLog(arquivoPos, s); };
                        Instalador.Progresso = delegate(int pct, string s) { };

                        string erroPos;
                        bool deuCerto = Instalador.PosInstalacao(sozinho, out erroPos);
                        if (!deuCerto) Instalador.EscreveNoLog(arquivoPos, "FALHOU: " + erroPos);
                        else Instalador.EscreveNoLog(arquivoPos, "pos-instalacao concluida.");
                        Environment.ExitCode = deuCerto ? 0 : 1;
                        return;
                    }
                    case "--restaurar":
                        Instalador.RestauraVersaoAnterior(true);
                        return;
                    case "--restaurar-silencioso":
                        // Sem caixa de dialogo, para o desinstalador e para teste.
                        Environment.ExitCode = Instalador.RestauraVersaoAnterior(false) ? 0 : 1;
                        return;
                    case "--desinstalar":
                        Instalador.Desinstala();
                        return;
                    case "--iniciar":
                        Aplicacao.Inicia();
                        return;
                    case "--version":
                        Console.WriteLine(Nome + " " + Versao);
                        return;
                    default:
                        Application.EnableVisualStyles();
                        Application.SetCompatibleTextRenderingDefault(false);
                        Application.Run(new JanelaInstalador());
                        return;
                }
            }
            catch (Exception e)
            {
                /*
                 * Instalador que falha sem dizer por que e' o pior resultado
                 * possivel: a pessoa ve a janela fechar e nao sabe se foi o
                 * Windows, o antivirus ou o sistema.
                 *
                 * Mas a caixa de dialogo so vale para quem esta com a tela na
                 * frente. Nos modos de linha de comando -- que e' como o Inno
                 * Setup chama este .exe, e como os testes automaticos chamam -- a
                 * `MessageBox` abre sem ninguem para responder, e o processo fica
                 * parado para sempre. Foi assim que um teste de restauracao
                 * "travou": nao era o Windows, era a propria caixa pedindo
                 * confirmacao para ninguem.
                 *
                 * Entao: modo de linha de comando registra no log e sai com
                 * codigo de erro, que e' o que quem espera um codigo de erro.
                 */
                if (modo.StartsWith("--") && modo != "--restaurar")
                {
                    Instalador.EscreveNoLog(Instalador.LogDeInstalacao(), "ERRO: " + e.Message);
                    Environment.ExitCode = 1;
                    return;
                }

                MessageBox.Show(
                    "Nao foi possivel concluir.\n\n" + e.Message,
                    "DeliveryAdmin", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static void EnableHighDpi()
        {
            // reflection em vez de referencia: o metodo So' existe em .NET 4.7+,
            // e compilar contra ele quebraria em uma maquina com 4.6, que ainda
            // existe em loja de bairro.
            Type t = Type.GetType("System.Windows.Forms.Application, System.Windows.Forms");
            if (t == null) return;
            System.Reflection.MethodInfo m = t.GetMethod("SetHighDpiMode", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
            if (m != null) m.Invoke(null, new object[] { 2 }); // PerMonitorV2
        }

        /// <summary>
        /// Descompacta o programa do ZIP que esta ao lado deste .exe.
        ///
        /// POR QUE PELO POWERSHELL E NAO PELA BIBLIOTECA DE ZIP DO .NET
        ///
        /// A primeira versao usava `System.IO.Compression.ZipFile`, que dava ate
        /// barra de progresso arquivo por arquivo. Compilou, e o .exe passou a dar
        /// erro na HORA DE ABRIR: "falha na inicializacao do aplicativo devida a
        /// configuracao lado a lado incorreta". `System.IO.Compression` nao esta
        /// no GAC do .NET Framework 4.8 de forma que o Windows resolva sozinho --
        /// precisaria ir junto do executavel, e ai a distribuicao para de ser um
        /// arquivo so e ganha dois arquivos que so existem por causa da
        /// biblioteca.
        ///
        /// O `Expand-Archive` e' do PowerShell, que esta em toda maquina Windows
        /// desde o 7. E' uma dependencia de verdade: nao depende de GAC, nao
        /// precisa ir junto e nao quebra. A barra de progresso exata foi trocada
        /// por uma indicacao de "esta working, leva um minuto", que e' a troca
        /// certa entre uma barra bonita e um programa que abre.
        /// </summary>
        private static bool Descompacta(string zip, string destino)
        {
            JanelaProgresso janela = new JanelaProgresso(0);
            janela.Informar("Descompactando o programa...");
            janela.Show();
            janela.Refresh();

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(
                    "powershell",
                    "-NoProfile -ExecutionPolicy Bypass -Command " +
                    "\"Expand-Archive -LiteralPath '" + zip.Replace("'", "''") + "' -DestinationPath '" + destino.Replace("'", "''") + "' -Force\""
                );
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;

                using (Process p = Process.Start(psi))
                {
                    p.StandardOutput.ReadToEnd();
                    string erro = p.StandardError.ReadToEnd();
                    // Sem limite de tempo: um pacote de 100 MB em um disco lento
                    // de rede pode levar alguns minutos, e matar no meio deixaria
                    // a pasta pela metade -- que e' pior do que esperar.
                    p.WaitForExit();

                    if (p.ExitCode != 0)
                    {
                        janela.Fechar();
                        MessageBox.Show(
                            "Nao consegui abrir o programa compactado.\n\n" +
                            (erro.Length > 0 ? erro : "O Windows recusou de extrair o arquivo.") +
                            "\n\nTente extrair o arquivo de novo (clique com o botao direito e \"Extrair tudo\") e rodar de novo.",
                            "DeliveryAdmin", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return false;
                    }
                }

                janela.Fechar();
                return File.Exists(Path.Combine(destino, "DeliveryAdmin.exe"));
            }
            catch (Exception e)
            {
                janela.Fechar();
                MessageBox.Show(
                    "Nao consegui abrir o programa compactado.\n\n" + e.Message,
                    "DeliveryAdmin", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return false;
            }
        }
    }

    // ================================================================== tela

    internal sealed class JanelaInstalador : Form
    {
        private readonly Panel _cartao;
        private readonly Label _titulo;
        private readonly Label _texto;
        private readonly Botao _principal;
        private readonly Botao _secundario;
        private readonly CheckBox _abrirAoTerminar;
        private readonly ListBox _log;
        private readonly Panel _barra;
        private readonly Label _passo;

        private int _etapa; // 0 = boas-vindas, 1 = instalando, 2 = concluido

        public JanelaInstalador()
        {
            Text = "Instalar DeliveryAdmin";
            ClientSize = new Size(600, 460);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Cores.Fundo;
            Font = new Font("Segoe UI", 9.5F);
            DoubleBuffered = true;

            _cartao = new Panel { Bounds = new Rectangle(28, 24, 544, 300), BackColor = Cores.Cartao };
            Cantos.Aplica(_cartao, Cores.RaioCartao);
            Controls.Add(_cartao);

            _titulo = new Label
            {
                Font = new Font("Segoe UI", 19F, FontStyle.Bold),
                ForeColor = Cores.Texto1,
                Bounds = new Rectangle(32, 28, 480, 34)
            };
            _cartao.Controls.Add(_titulo);

            _texto = new Label
            {
                ForeColor = Cores.Texto2,
                Bounds = new Rectangle(32, 68, 480, 90)
            };
            _cartao.Controls.Add(_texto);

            // Barra de progresso desenhada a mao. A ProgressBar do Windows ignora
            // cor de fundo no tema claro e aparece cinza, o que destoa de tudo.
            _barra = new Panel { Bounds = new Rectangle(32, 168, 480, 8), BackColor = Cores.Superficie2, Visible = false };
            _cartao.Controls.Add(_barra);

            _passo = new Label
            {
                ForeColor = Cores.Texto3,
                Bounds = new Rectangle(32, 184, 480, 40),
                Visible = false
            };
            _cartao.Controls.Add(_passo);

            _log = new ListBox
            {
                Bounds = new Rectangle(32, 152, 480, 128),
                BackColor = Cores.Superficie2,
                ForeColor = Cores.Texto2,
                BorderStyle = BorderStyle.None,
                Font = new Font("Consolas", 9F),
                Visible = false
            };
            _cartao.Controls.Add(_log);

            _abrirAoTerminar = new CheckBox
            {
                Text = "Abrir o painel quando terminar",
                Checked = true,
                Bounds = new Rectangle(32, 330, 280, 24),
                ForeColor = Cores.Texto2,
                Visible = false,
                FlatStyle = FlatStyle.Flat
            };
            _abrirAoTerminar.FlatAppearance.BorderColor = Cores.Borda;
            _abrirAoTerminar.FlatAppearance.CheckedBackColor = Cores.Acento;
            Controls.Add(_abrirAoTerminar);

            _principal = new Botao("Instalar", true) { Bounds = new Rectangle(372, 366, 200, 44) };
            _principal.Click += delegate(object s, EventArgs e) { ClicouPrincipal(); };
            Controls.Add(_principal);

            _secundario = new Botao("Cancelar", false) { Bounds = new Rectangle(252, 366, 110, 44) };
            _secundario.Click += delegate(object s, EventArgs e) { Close(); };
            Controls.Add(_secundario);

            // `Resize` e' o evento; `OnResize` e' o metodo sobrescrito, e nao
            // aceita `+=`. O canto do cartao precisa recalcular quando a janela
            // muda de tamanho, senao o Region fica com o retangulo antigo.
            Resize += delegate(object s, EventArgs e) { Cantos.Aplica(_cartao, Cores.RaioCartao); };
            TelaBoasVindas();
        }

        private void TelaBoasVindas()
        {
            _etapa = 0;
            _titulo.Text = "DeliveryAdmin";
            _texto.Text =
                "O painel de pedidos, estoque e WhatsApp da sua loja.\n\n" +
                "Vai ser instalado em:\n" + Programa.PastaPrograma + "\n\n" +
                "Os dados -- banco, conversas do WhatsApp, backups e log -- ficam em:\n" +
                Programa.PastaDados + "\n\n" +
                "Instalar aqui nao pede cadastro, nao pede cartao e nao depende de " +
                "programa nenhum: o proprio instalador traz o que ele precisa.";
            _principal.Text = "Instalar";
            _secundario.Text = "Cancelar";
            _secundario.Visible = true;
            _abrirAoTerminar.Visible = false;
            _barra.Visible = false;
            _passo.Visible = false;
            _log.Visible = false;
        }

        private void TelaInstalando()
        {
            _etapa = 1;
            _titulo.Text = "Instalando";
            _texto.Text = "Nao feche esta janela.";
            _principal.Visible = false;
            _secundario.Text = "Cancelar";
            _secundario.Enabled = false;
            _barra.Visible = true;
            _passo.Visible = true;
            _log.Visible = true;
            _abrirAoTerminar.Visible = false;
        }

        private void TelaConcluida(string titulo, string texto, bool ok)
        {
            _etapa = 2;
            _titulo.Text = titulo;
            _texto.Text = texto;
            _texto.ForeColor = ok ? Cores.Texto2 : Cores.Erro;
            _cartao.BackColor = ok ? Cores.Cartao : Cores.ErroFundo;
            _barra.Visible = false;
            _passo.Visible = false;
            _log.Visible = false;
            _abrirAoTerminar.Visible = true;
            _principal.Text = ok ? "Abrir o painel" : "Fechar";
            _principal.Visible = true;
            _secundario.Visible = false;
        }

        private void ClicouPrincipal()
        {
            if (_etapa == 0) { Instala(); return; }
            if (_etapa == 2)
            {
                if (_abrirAoTerminar.Checked) Aplicacao.Inicia();
                Close();
            }
        }

        private void Instala()
        {
            TelaInstalando();
            // A copia leva tempo e travaria a janela se rodasse na mesma thread.
            new Thread(delegate()
            {
                Instalador.Log = delegate(string s)
                {
                    BeginInvoke(new MethodInvoker(delegate
                    {
                        _log.Items.Add(s);
                        _log.TopIndex = _log.Items.Count - 1;
                        _passo.Text = s;
                    }));
                };
                Instalador.Progresso = delegate(int pct, string s)
                {
                    BeginInvoke(new MethodInvoker(delegate { _barra.Width = Math.Max(1, (int)(480.0 * pct / 100.0)); }));
                };

                bool deuCerto;
                string erro;
                try { deuCerto = Instalador.InstalaComRelatorio(out erro); }
                catch (Exception e) { deuCerto = false; erro = e.Message; }

                BeginInvoke(new MethodInvoker(delegate
                {
                    if (deuCerto)
                    {
                        TelaConcluida("Pronto",
                            "O DeliveryAdmin foi instalado.\n\n" +
                            "O atalho \"DeliveryAdmin\" esta no Menu Iniciar e na Area de Trabalho, e o " +
                            "painel sobe junto com o Windows.\n\n" +
                            "Se quiser abrir agora, e' so clicar no botao abaixo.", true);
                    }
                    else
                    {
                        TelaConcluida("Nao foi possivel instalar", erro, false);
                        _principal.Text = "Fechar";
                    }
                }));
            })
            { IsBackground = true }.Start();
        }
    }

    // =============================================================== instalar

    internal static class Instalador
    {
        public static Action<string> Log = delegate { };
        public static Action<int, string> Progresso = delegate { };

        /// <summary>
        /// O que roda DEPOIS que o instalador copiasse os arquivos.
        ///
        /// Divisao do trabalho com o Inno Setup
        ///
        /// O Inno Setup cuida do que ele faz melhor e que seria chato de
        /// reescrever: um `.exe` unico compactado, barra de progresso real, pedir
        /// permissao de administrador, criar e remover atalho, desinstalador
        /// registrado em "Apps instalados". Isso e' trabalho de anos que ele ja
        /// tem pronto, e refazer na mao seria perder tempo recriando coisa pior.
        ///
        /// O que ele NAO faz, e nao tem como fazer, e' falar com o banco. Entao a
        /// divisao fica assim: o Inno copia, este .exe configura.
        ///
        /// `--iniciar-sozinho` e' o que o Inno passa para o Inno marcar
        /// "iniciar o DeliveryAdmin agora". Vem do parametro, e nao do registro,
        /// porque o Inno so faz consulta de registro DEPOIS do "[Run]".
        /// </summary>
        public static bool PosInstalacao(bool iniciarSozinho, out string erro)
        {
            erro = null;
            try
            {
                string destino = Programa.PastaPrograma;

                Log("Escrevendo a configuracao...");
                Progresso(88, "Escrevendo a configuracao...");
                EscreveEnv(destino);
                CriaArvoreDeDados();

                Log("Gerando o acesso ao banco...");
                Progresso(90, "Gerando o acesso ao banco...");
                RodaPrisma(destino, "generate");

                // A copia do banco ANTES da migracao. E' o que devolve o sistema
                // ao estado anterior se a migracao falhar -- migracao que falha
                // pode deixar o esquema pela metade, e ai o sistema nem abre.
                Log("Guardando o banco...");
                Progresso(92, "Guardando o banco...");
                string copiaBanco = GuardaBancoAntesDaMigracao(destino);

                Log("Preparando o banco...");
                Progresso(94, "Preparando o banco...");
                try
                {
                    RodaPrisma(destino, "migrate", "deploy");
                }
                catch (Exception e)
                {
                    Log("A migracao falhou. Devolvendo o banco...");
                    bool voltou = RestauraBanco(copiaBanco, destino);
                    throw new Exception(
                        "A atualizacao do banco falhou" + (voltou ? " e o banco foi devolvido ao estado anterior" : "") +
                        ".\n\n" + e.Message
                    );
                }

                Log("Escolhendo iniciar com o Windows...");
                Progresso(97, "Escolhendo iniciar com o Windows...");
                DefineAutostart(true);

                if (iniciarSozinho)
                {
                    Log("Abrindo o painel...");
                    Progresso(99, "Abrindo o painel...");
                    Aplicacao.Inicia(false);
                }

                Progresso(100, "Concluido.");
                return true;
            }
            catch (Exception e)
            {
                erro = e.Message;
                return false;
            }
        }

        public static void InstalaSilencioso()
        {
            // Modo silencioso sem log e' modo cego. O instalador de arquivo unico
            // roda assim, e a pessoa que falha nao tem nem janela para ver.
            string arquivo = LogDeInstalacao();
            Log = delegate(string s) { EscreveNoLog(arquivo, s); };
            Progresso = delegate(int pct, string s) { };

            string erro;
            if (!InstalaComRelatorio(out erro))
            {
                EscreveNoLog(arquivo, "FALHOU: " + erro);
                MessageBox.Show("Instalacao falhou.\n\n" + erro, "DeliveryAdmin", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Environment.Exit(1);
            }
            EscreveNoLog(arquivo, "Instalacao concluida.");
        }

        /// <summary>
        /// Onde o modo silencioso escreve o que fez.
        ///
        /// Na pasta TEMP e nao na de dados: se a instalacao falhar antes de criar
        /// a pasta de dados -- que e' o caso mais provavel de falha --, o log
        /// precisa existir em algum lugar que exista. E TEMP nao some quando o
        /// Windows limpa, entao ele e' encontrado depois de reiniciar.
        /// </summary>
        internal static string LogDeInstalacao()
        {
            return Path.Combine(Path.GetTempPath(), "DeliveryAdmin-instalacao.log");
        }

        internal static void EscreveNoLog(string arquivo, string linha)
        {
            try
            {
                File.AppendAllText(arquivo, "[" + DateTime.Now.ToString("HH:mm:ss") + "] " + linha + Environment.NewLine);
            }
            catch { }
        }

        /// <summary>
        /// Instala. Cada passo e' pulado quando ja esta feito, e por isso rodar de
        /// novo serve como atualizacao sem risco.
        ///
        /// A RISCO, E O QUE ESTA METODO FAZ CONTRA ELE
        ///
        /// "Roda de novo e atualiza" e' verdade, e tambem e' onde mora o perigo
        /// real de um instalador:
        ///
        /// 1. O PROGRAMA ANTIGO some. A copia sobrescreve arquivo por arquivo.
        ///    Se a versao nova tiver defeito, nao ha como voltar sem ir buscar a
        ///    versao antiga na mao. Por isso a pasta atual e' renomeada para
        ///    `.anterior` antes de qualquer copia -- renomear e' instantaneo e
        ///    nao custa espaco, e a volta passa a ser um comando.
        ///
        /// 2. A MIGRACAO DO BANCO NAO TEM VOLTA. Este e' o ponto serio. O dado
        ///    esta' em outra pasta e por isso uma atualizacao de programa nao o
        ///    toca -- mas a propria atualizacao roda `migrate deploy`, e uma
        ///    migracao que dee errado ja' mudou o esquema. Voltar so o programa
        ///    deixaria um codigo velho falando com um banco novo.
        ///
        ///    A defesa e' uma copia do arquivo do banco ANTES da migracao, e a
        ///    restauracao automatica se a migracao falhar. Nao e' prevention de
        ///    defeito: e' a garantia de que falha de atualizacao deixa o sistema
        ///    como estava, e nao como nao deveria ter ficado.
        /// </summary>
        public static bool InstalaComRelatorio(out string erro)
        {
            erro = null;
            try
            {
                string destino = Programa.PastaPrograma;
                string payload = PegaPastaDoPayload();

                Log("Verificando o que veio junto...");
                if (!File.Exists(Path.Combine(payload, "DeliveryAdmin.exe")))
                    throw new Exception("O instalador esta sem o programa. Baixe o instalador de novo, inteiro.");

                /*
                 * O destino nao pode estar dentro do payload -- nem o payload
                 * dentro do destino.
                 *
                 * Isso nao e' um caso teorico do `--destino`: e' o que acontece
                 * quando a pessoa extrai o ZIP e manda instalar na propria pasta
                 * onde extraiu, que e' exatamente onde o duplo clique deixa o
                 * programa. A copia comeca a copiar a pasta de destino para
                 * dentro dela mesma, e o caminho cresce 40 niveis ate o Windows
                 * recusar por "caminho muito longo". Sem esta trava, a pessoa ve
                 * uma tela que instala 1.241 arquivos e depois falha.
                 */
                ConfereNaoAninhado(payload, destino);

                Log("Fechando o sistema, se estiver aberto...");
                ParaOServidor(destino);

                Log("Guardando a versao anterior...");
                Progresso(20, "Guardando a versao anterior...");
                GuardaVersaoAnterior(destino);

                Log("Preparando a pasta do programa...");
                Directory.CreateDirectory(destino);
                CopiaPasta(payload, destino, new string[] { "DeliveryAdmin.exe" });

                Log("Copiando o programa...");
                Progresso(30, "Copiando o programa...");
                CopiaPasta(payload, destino, new string[0]);

                Log("Escrevendo a configuracao...");
                Progresso(62, "Escrevendo a configuracao...");
                EscreveEnv(destino);
                CriaArvoreDeDados();

                // A copia do banco ANTES da migracao. E' o que devolve o sistema
                // ao estado anterior se a migracao falhar.
                Log("Guardando o banco...");
                Progresso(66, "Guardando o banco...");
                string copiaBanco = GuardaBancoAntesDaMigracao(destino);

                Log("Preparando o banco...");
                Progresso(70, "Preparando o banco...");
                try
                {
                    RodaPrisma(destino, "migrate", "deploy");
                }
                catch (Exception e)
                {
                    // A migracao falhou e pode ter deixado o banco pela metade.
                    // Devolver a copia e' melhor do que deixar a pessoa com um
                    // sistema que nem abre, e e' barato: um arquivo.
                    Log("A migracao falhou. Devolvendo o banco...");
                    bool voltou = RestauraBanco(copiaBanco, destino);
                    throw new Exception(
                        "A atualizacao do banco falhou" + (voltou ? " e o banco foi devolvido ao estado anterior" : "") +
                        ".\n\n" + e.Message +
                        "\n\nO programa esta instalado, mas so abre depois de uma nova tentativa de instalacao."
                    );
                }

                Log("Criando os atalhos...");
                Progresso(85, "Criando os atalhos...");
                CriaAtalhos(destino);

                Log("Registrando em \"Apps installed\"...");
                RegistraDesinstalador(destino);

                Log("Escolhendo iniciar com o Windows...");
                DefineAutostart(true);

                Progresso(100, "Concluido.");
                return true;
            }
            catch (Exception e)
            {
                erro = e.Message;
                return false;
            }
        }

        /// <summary>A pasta da versao anterior, ao lado da atual.</summary>
        public static string PastaAnterior
        {
            get { return Programa.PastaPrograma + ".anterior"; }
        }

        /// <summary>
        /// Renomeia o programa atual para `.anterior`, para a volta ser possivel.
        ///
        /// A versao anterior do ANTERIOR e' apagada. E' proposital: guardar tres
        /// versoes ocuparia centenas de megabytes no disco do cliente, e voltar
        /// duas atualizacoes raramente e' o que a pessoa precisa. Uma e' o
        /// suficiente para o caso real, que e' "a versao de ontem estragou".
        /// </summary>
        private static void GuardaVersaoAnterior(string destino)
        {
            try
            {
                if (Directory.Exists(PastaAnterior)) Directory.Delete(PastaAnterior, true);
                if (!Directory.Exists(destino)) return;
                if (!File.Exists(Path.Combine(destino, "DeliveryAdmin.exe"))) return;
                Directory.Move(destino, PastaAnterior);
                EscreveNoLog(LogDeInstalacao(), "versao anterior guardada em " + PastaAnterior);
            }
            catch (Exception e)
            {
                // Nao derruba a instalacao por causa disso: e' uma garantia extra,
                // e perder a garantia e' melhor do que nao instalar.
                EscreveNoLog(LogDeInstalacao(), "aviso: nao consegui guardar a versao anterior (" + e.Message + ")");
            }
        }

        /// <summary>
        /// Devolve o sistema para a versao anterior.
        ///
        /// Troca as duas pastas de lugar. O que torna isso seguro e' a separacao
        /// dos dados: o banco, a sessao do WhatsApp e os backups estao em outra
        /// pasta e nao entram na troca, entao a versao antiga volta enxergando o
        /// mesmo banco.
        ///
        /// A exececao e' quando o esquema do banco mudou entre as duas versoes: ai
        /// o codigo antigo pode nao entender a tabela nova. Nao da para resolver
        /// isso aqui, e o que da e' dizer com clareza, em vez de devolver um
        /// sistema que abre e quebra na segunda tela.
        /// </summary>
        public static void RestauraVersaoAnterior()
        {
            RestauraVersaoAnterior(true);
        }

        /// <summary>
        /// Mesma operacao, sem perguntar. `perguntar = false` e' o que a janela usa
        /// depois que a pessoa ja respondeu "sim" na propria caixa, e o que o
        /// desinstalador usa quando a propria desinstalacao falhou.
        /// </summary>
        public static bool RestauraVersaoAnterior(bool perguntar)
        {
            if (!Directory.Exists(PastaAnterior))
            {
                if (perguntar)
                    MessageBox.Show("Nao existe versao anterior guardada.", "DeliveryAdmin", MessageBoxButtons.OK, MessageBoxIcon.Information);
                else
                    EscreveNoLog(LogDeInstalacao(), "nao ha versao anterior para restaurar");
                return false;
            }

            if (perguntar)
            {
                DialogResult r = MessageBox.Show(
                    "Voltar para a versao anterior?\n\n" +
                    "O programa volta para como estava antes da ultima instalacao. " +
                    "Seus dados continuam onde estao.",
                    "DeliveryAdmin", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (r != DialogResult.Yes) return false;
            }

            string atual = Programa.PastaPrograma;
            string reserva = atual + ".antes-de-restaurar";

            try
            {
                ParaOServidor(atual);
                if (Directory.Exists(reserva)) Directory.Delete(reserva, true);
                if (Directory.Exists(atual)) Directory.Move(atual, reserva);
                Directory.Move(PastaAnterior, atual);
                EscreveNoLog(LogDeInstalacao(), "versao restaurada de " + PastaAnterior);
            }
            catch (Exception e)
            {
                // Se a troca falhou no meio, tenta voltar a posicao inicial. Deixar
                // as duas pastas com nomes trocados seria pior que nao restaurar.
                try
                {
                    if (!Directory.Exists(atual) && Directory.Exists(reserva)) Directory.Move(reserva, atual);
                }
                catch { }
                if (perguntar)
                    MessageBox.Show("Nao consegui voltar a versao anterior.\n\n" + e.Message,
                        "DeliveryAdmin", MessageBoxButtons.OK, MessageBoxIcon.Error);
                else
                    EscreveNoLog(LogDeInstalacao(), "ERRO ao restaurar: " + e.Message);
                return false;
            }

            if (perguntar)
                MessageBox.Show(
                    "Voltamos para a versao anterior.\n\nSe o painel reclamar de tela ou dado, " +
                    "o banco pode ter mudado de formato. Nesse caso, reinstale a versao nova.",
                    "DeliveryAdmin", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return true;
        }

        /// <summary>
        /// Copia o arquivo do banco antes da migracao, e devolve o caminho.
        ///
        /// Devolve string vazia quando nao ha banco ainda (primeira instalacao) ou
        /// quando a copia falhou. Quem chama trata a string vazia como "nao havia
        /// nada a guardar", e nao como erro: a instalacao nova em banco novo nao
        /// tem o que preservar.
        /// </summary>
        private static string GuardaBancoAntesDaMigracao(string destino)
        {
            try
            {
                string url = EnvironmentVariable("DATABASE_URL");
                if (string.IsNullOrEmpty(url)) return "";

                string arquivo = url.StartsWith("file:") ? url.Substring(5) : url;
                if (arquivo.StartsWith("./")) arquivo = Path.Combine(destino, arquivo.Substring(2));
                if (!File.Exists(arquivo)) return "";

                string pasta = Path.Combine(Programa.PastaDados, "backups");
                if (!Directory.Exists(pasta)) Directory.CreateDirectory(pasta);

                string destino2 = Path.Combine(pasta, "antes-da-atualizacao-" + Carimbo() + ".db");
                File.Copy(arquivo, destino2, true);
                EscreveNoLog(LogDeInstalacao(), "banco guardado em " + destino2);
                return destino2;
            }
            catch (Exception e)
            {
                EscreveNoLog(LogDeInstalacao(), "aviso: nao consegui guardar o banco (" + e.Message + ")");
                return "";
            }
        }

        /// <summary>Devolve o banco de antes da atualizacao. `true` quando restaurou.</summary>
        private static bool RestauraBanco(string copia, string destino)
        {
            if (string.IsNullOrEmpty(copia) || !File.Exists(copia)) return false;
            try
            {
                string url = EnvironmentVariable("DATABASE_URL");
                string arquivo = url.StartsWith("file:") ? url.Substring(5) : url;
                if (arquivo.StartsWith("./")) arquivo = Path.Combine(destino, arquivo.Substring(2));

                if (File.Exists(arquivo)) File.Delete(arquivo);
                File.Copy(copia, arquivo, true);
                EscreveNoLog(LogDeInstalacao(), "banco restaurado de " + copia);
                return true;
            }
            catch (Exception e)
            {
                EscreveNoLog(LogDeInstalacao(), "ERRO ao restaurar o banco: " + e.Message);
                return false;
            }
        }

        /** Carimbo de data e hora no nome, no mesmo formato das copias do sistema. */
        private static string Carimbo()
        {
            DateTime d = DateTime.Now;
            return d.ToString("yyyy-MM-dd_HHmm");
        }

        /// <summary>
        /// A pasta do payload e' a do proprio .exe.
        ///
        /// Nao e' "a pasta de onde foi chamado" e nem uma pasta temporaria: quando
        /// o instalador de arquivo unico extrai e chama, os doisTem o mesmo
        /// conteudo, e usar o que esta do lado do executavel funciona nos dois
        /// casos sem parametro nenhum.
        /// </summary>
        private static string PegaPastaDoPayload()
        {
            return AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        }

        /// <summary>
        /// Recusa instalar em cima da propria origem.
        ///
        /// A comparacao ignora a barra final, porque `C:\Programa\` e `C:\Programa`
        /// sao a mesma pasta e o Windows trata as duas. E a barra invertida
        /// tambem: quem digita o caminho no console usa `\` e quem digita na tela
        /// costuma colar `\` tambem, mas um caminho vindo de outra maquina pode
        /// vir com `/`.
        /// </summary>
        private static void ConfereNaoAninhado(string payload, string destino)
        {
            string a = payload.TrimEnd('\\', '/');
            string b = destino.TrimEnd('\\', '/');

            if (string.Equals(a, b, StringComparison.OrdinalIgnoreCase))
            {
                throw new Exception(
                    "Este e' o proprio programa instalado, rodando de onde ele esta.\n\n" +
                    "Para instalar ou atualizar, abra o instalador novo em outra pasta e rode ele " +
                    "de la. O de dentro da pasta instalada e' so para abrir o painel."
                );
            }

            if (b.StartsWith(a + "\\", StringComparison.OrdinalIgnoreCase))
            {
                throw new Exception(
                    "O destino esta DENTRO da pasta do instalador.\n\n" +
                    "A copia do programa entraria dentro de si mesma. Escolha uma pasta fora daqui, " +
                    "por exemplo " + Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) + "."
                );
            }
        }

        private static void CopiaPasta(string origem, string destino, string[] pular)
        {
            if (!Directory.Exists(origem)) return;

            /*
             * A pasta de destino e' criada AQUI, e nao pelo chamador.
             *
             * A primeira versao criava a pasta de destino so na raiz, e a
             * recursao passava direto para os arquivos. O resultado foi o erro
             * "nao foi possivel localizar uma parte do caminho .../dist/
             * controllers/adminController.js" na primeira instalacao de teste --
             * o `File.Copy` nao cria o diretorio, ele complains.
             */
            try
            {
                if (!Directory.Exists(destino)) Directory.CreateDirectory(destino);
            }
            catch (Exception e)
            {
                throw new Exception("Nao consegui criar a pasta " + destino + ". " + e.Message);
            }

            string[] subpastas;
            try { subpastas = Directory.GetDirectories(origem); } catch { subpastas = new string[0]; }

            foreach (string s in subpastas)
            {
                // A `runtime` NAO e' pulada. Ela traz o node.exe, e sem ele o
                // programa instalado nao sobe -- e o sintoma e' o pior possivel:
                // a instalacao termina com "pronto" e o atalho abre uma janela
                // dizendo que o sistema nao esta instalado. Foi o primeiro
                // rascunho, que pulava achando que o runtime era copiado a parte
                // por outra etapa. Nao existe outra etapa.
                CopiaPasta(s, Path.Combine(destino, Path.GetFileName(s)), pular);
            }

            string[] arquivos;
            try { arquivos = Directory.GetFiles(origem); } catch { arquivos = new string[0]; }

            foreach (string a in arquivos)
            {
                string nome = Path.GetFileName(a);
                bool pula = false;
                foreach (string p in pular) if (nome.Equals(p, StringComparison.OrdinalIgnoreCase)) pula = true;
                if (pula) continue;

                string alvo = Path.Combine(destino, nome);
                // Copiar sempre e' mais seguro do que comparar data: um arquivo
                // truncado por um disco cheio e' justamente o que precisa ser
                // reescrito, e comparar data nao pegaria isso.
                try { File.Copy(a, alvo, true); } catch (IOException) { File.Copy(a, alvo, true); }
            }
        }

        private static void EscreveEnv(string destino)
        {
            string banco = Path.Combine(Programa.PastaDados, "prisma", "marmitaria.db");
            // A barra do caminho vira barra e' o que o SQLite aceita em Windows;
            // com barra invertida, o Prisma trata como sequencia de escape.
            banco = banco.Replace('\\', '/');
            string dados = Programa.PastaDados.Replace('\\', '/');

            string conteudo =
                "# Escrito pelo instalador. Nao precisa editar a mao.\n" +
                "#\n" +
                "# A pasta de dados e' separada da pasta do programa de proposito: e' o que\n" +
                "# faz uma atualizacao poder trocar o programa sem encostar no banco, na\n" +
                "# sessao do WhatsApp nem nos backups.\n\n" +
                "DELIVERYADMIN_DATA=\"" + dados + "\"\n" +
                "DATABASE_URL=\"file:" + banco + "\"\n" +
                "HOST=127.0.0.1\n" +
                "PORT=3000\n";

            // A porta so nesta maquina por padrao. O sistema escuta em 0.0.0.0
            // quando developing, e ai qualquer aparelho da mesma rede da loja
            // chega no faturamento -- inclusive quem nao tem a senha, porque a
            // tela de entrada e' a fronteira e nao a rede.
            File.WriteAllText(Path.Combine(destino, ".env"), conteudo);
        }

        private static void CriaArvoreDeDados()
        {
            string baseDados = Programa.PastaDados;
            Directory.CreateDirectory(baseDados);
            Directory.CreateDirectory(Path.Combine(baseDados, "logs"));
            Directory.CreateDirectory(Path.Combine(baseDados, "backups"));
            Directory.CreateDirectory(Path.Combine(baseDados, "prisma"));
            Directory.CreateDirectory(Path.Combine(baseDados, "auth_info_baileys"));
            Directory.CreateDirectory(Path.Combine(baseDados, "uploads", "produtos"));
        }

        private static void RodaPrisma(string destino, params string[] args)
        {
            string node = Path.Combine(destino, "runtime", "node.exe");
            string cli = Path.Combine(destino, "node_modules", "prisma", "build", "index.js");
            if (!File.Exists(cli))
                throw new Exception("O instalador veio sem o Prisma CLI, e sem ele o banco nao pode ser preparado. Baixe de novo.");

            ProcessStartInfo psi = new ProcessStartInfo(node, "\"" + cli + "\" " + string.Join(" ", args));
            psi.WorkingDirectory = destino;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;

            // Sem isto o `dotnet`/Node abre uma janela de console no meio do
            // instalador, por baixo da janela com as cores.
            psi.EnvironmentVariables["DATABASE_URL"] = EnvironmentVariable("DATABASE_URL");

            using (Process p = Process.Start(psi))
            {
                string saida = p.StandardOutput.ReadToEnd();
                p.StandardError.ReadToEnd();
                p.WaitForExit(180000);
                if (!p.HasExited)
                {
                    try { p.Kill(); } catch { }
                    throw new Exception("A preparacao do banco demorou demais e foi interrompida. Tente instalar de novo.");
                }
                if (p.ExitCode != 0)
                    throw new Exception("A preparacao do banco falhou. Detalhe: " + UltimaLinha(saida));
            }
        }

        private static string EnvironmentVariable(string chave)
        {
            string arquivo = Path.Combine(Programa.PastaPrograma, ".env");
            try
            {
                foreach (string linha in File.ReadAllLines(arquivo))
                {
                    int i = linha.IndexOf('=');
                    if (i < 1) continue;
                    if (linha.Substring(0, i).Trim() != chave) continue;
                    return linha.Substring(i + 1).Trim().Trim('"');
                }
            }
            catch { }
            return "";
        }

        private static string UltimaLinha(string texto)
        {
            if (string.IsNullOrEmpty(texto)) return "sem detalhe";
            string[] linhas = texto.Split('\n');
            for (int i = linhas.Length - 1; i >= 0; i--)
            {
                string t = linhas[i].Trim();
                if (t.Length > 0) return t.Length > 200 ? t.Substring(t.Length - 200) : t;
            }
            return "sem detalhe";
        }

        private static void CriaAtalhos(string destino)
        {
            try { Directory.CreateDirectory(Programa.PastaMenu); } catch { }

            string exe = Path.Combine(destino, "DeliveryAdmin.exe");
            string menu = Path.Combine(Programa.PastaMenu, "DeliveryAdmin.lnk");
            string area = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "DeliveryAdmin.lnk");

            CriaAtalho(menu, exe, "DeliveryAdmin", "--iniciar", "abrir o painel");
            CriaAtalho(area, exe, "DeliveryAdmin", "--iniciar", "abrir o painel");
        }

        /// <summary>
        /// Cria o .lnk pelo IShellLink, que e' a interface que o proprio Windows
        /// usa. Sem dependencia externa: e' uma COM de sistema.
        ///
        /// Cada propriedade e' escrita dentro do seu proprio try. A primeira
        /// versao escrevia todas em sequencia e a excecao do COM derrubava a
        /// instalacao inteira -- no caso, o `IconLocation` em um .exe sem icone
        /// dentro. Um atalho sem icone e' feio; uma instalacao que nao termina
        /// e' pior. O que der erro e' omitido, e o resto e' gravado.
        /// </summary>
        private static void CriaAtalho(string caminho, string alvo, string nome, string argumentos, string comentario)
        {
            /*
             * Atalho e' conveniencia, e a instalacao nao pode falhar por causa
             * dele.
             *
             * A primeira versao deixou o `CreateShortcut` fora do tratamento de
             * erro, e ele lanca `TargetInvocationException` quando o shell nao
             * tem acesso as pastas especiais -- que e' o caso de uma sessao sem
             * area de trabalho, de um servico, ou de um `Program Files` com
             * perfil semArea de Trabalho criada. O programa estava instalado e
             * funcional, e o instalador dizia que falhou.
             *
             * O que sobra e' o log, que e' o lugar certo para "nao consegui criar
             * o atalho": quem instalou pode criar a mao em dois segundos, e o
             * sistema funciona sem ele.
             */
            try
            {
                string pasta = Path.GetDirectoryName(caminho);
                if (string.IsNullOrEmpty(pasta) || !Directory.Exists(pasta))
                {
                    EscreveNoLog(LogDeInstalacao(), "aviso: pasta do atalho nao existe, pulando " + caminho);
                    return;
                }

                Type tipo = Type.GetTypeFromProgID("WScript.Shell");
                if (tipo == null)
                {
                    EscreveNoLog(LogDeInstalacao(), "aviso: WScript.Shell ausente, atalho nao criado");
                    return;
                }

                object shell = Activator.CreateInstance(tipo);
                try
                {
                    object l = tipo.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[0]);
                    Type lt = l.GetType();
                    Tenta(() => lt.InvokeMember("TargetPath", System.Reflection.BindingFlags.SetProperty, null, l, new object[] { alvo }));
                    Tenta(() => lt.InvokeMember("Arguments", System.Reflection.BindingFlags.SetProperty, null, l, new object[] { argumentos }));
                    Tenta(() => lt.InvokeMember("WorkingDirectory", System.Reflection.BindingFlags.SetProperty, null, l, new object[] { Path.GetDirectoryName(alvo) }));
                    Tenta(() => lt.InvokeMember("Description", System.Reflection.BindingFlags.SetProperty, null, l, new object[] { comentario }));
                    Tenta(() => lt.InvokeMember("IconLocation", System.Reflection.BindingFlags.SetProperty, null, l, new object[] { alvo + ",0" }));
                    Tenta(() => lt.InvokeMember("Save", System.Reflection.BindingFlags.InvokeMethod, null, l, new object[0]));
                }
                finally
                {
                    try { System.Runtime.InteropServices.Marshal.ReleaseComObject(shell); } catch { }
                }
            }
            catch (Exception e)
            {
                EscreveNoLog(LogDeInstalacao(), "aviso: atalho nao criado (" + caminho + "): " + e.Message);
            }
        }

        private static void Tenta(Action a)
        {
            try { a(); } catch { }
        }

        private static void RegistraDesinstalador(string destino)
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + Programa.Nome))
                {
                    if (k == null) return;
                    k.SetValue("DisplayName", "DeliveryAdmin");
                    k.SetValue("DisplayVersion", Programa.Versao);
                    k.SetValue("Publisher", "DeliveryAdmin");
                    k.SetValue("DisplayIcon", Path.Combine(destino, "DeliveryAdmin.exe"));
                    k.SetValue("InstallLocation", destino);
                    k.SetValue("UninstallString", "\"" + Path.Combine(destino, "DeliveryAdmin.exe") + "\" --desinstalar");
                    k.SetValue("NoModify", 1);
                    k.SetValue("NoRepair", 1);
                    k.SetValue("EstimatedSize", 250000);
                }
            }
            catch { }
        }

        /// <summary>
        /// Iniciar junto com o Windows, em HKCU.
        ///
        /// HKCU e nao HKLM de proposito: em HKLM o Windows exige administrador na
        /// hora de LOGAR, o que faria o sistema pedir senha a cada boot. Em HKCU
        /// o Windows sobe o sistema sozinho, e o pedido de administrador fica
        /// restrito a instalacao.
        /// </summary>
        public static void DefineAutostart(bool ligado)
        {
            try
            {
                string chave = @"Software\Microsoft\Windows\CurrentVersion\Run";
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(chave))
                {
                    if (k == null) return;
                    if (ligado) k.SetValue(Programa.Nome, "\"" + Path.Combine(Programa.PastaPrograma, "DeliveryAdmin.exe") + "\" --iniciar");
                    else k.DeleteValue(Programa.Nome, false);
                }
            }
            catch { }
        }

        public static void Desinstala()
        {
            DialogResult r = MessageBox.Show(
                "Remover o DeliveryAdmin?\n\n" +
                "Os dados ficam guardados em:\n" + Programa.PastaDados + "\n\n" +
                "Reinstalando depois, tudo volta como estava.",
                "DeliveryAdmin", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (r != DialogResult.Yes) return;

            try
            {
                ParaOServidor(Programa.PastaPrograma);
            }
            catch { }

            try { DefineAutostart(false); } catch { }

            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall", true))
                {
                    if (k != null) k.DeleteSubKeyTree(Programa.Nome);
                }
            }
            catch { }

            try
            {
                if (Directory.Exists(Programa.PastaMenu)) Directory.Delete(Programa.PastaMenu, true);
            }
            catch { }

            try
            {
                string area = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "DeliveryAdmin.lnk");
                if (File.Exists(area)) File.Delete(area);
            }
            catch { }

            // O .exe em si nao some: ele esta rodando. Um instalador que precisa
            // se apagar por ultimo, e o proprio programa em execucao e' o que
            // segura a pasta -- por isso a limpeza fica para o proximo boot.
            try
            {
                if (Directory.Exists(Programa.PastaPrograma))
                {
                    File.WriteAllText(
                        Path.Combine(Programa.PastaPrograma, "apagar.txt"),
                        "C:\\\\Windows\\\\System32\\\\cmd.exe /c ping 127.0.0.1 -n 3 > nul & rmdir /s /q \"" + Programa.PastaPrograma + "\""
                    );
                }
            }
            catch { }

            MessageBox.Show("O DeliveryAdmin foi removido.\n\nOs seus dados continuam em:\n" + Programa.PastaDados,
                "DeliveryAdmin", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Environment.Exit(0);
        }

        /// <summary>
        /// Pede ao servidor que desligue antes de trocar os arquivos.
        ///
        /// O caminho e' a rota local com token, e nao matar o processo: matar
        /// deixa transacao pela metade, que em um sistema que vende e' venda
        /// fantasma. Ver a nota longa em `desliga()`, no fim do src/server.ts.
        /// </summary>
        private static void ParaOServidor(string destino)
        {
            string node = Path.Combine(destino, "runtime", "node.exe");
            if (!File.Exists(node)) return;

            try
            {
                // O token vive no arquivo, escrito pelo programa que sobe o
                // servidor. Sem ele, o desligamento remoto fica desligado -- que e'
                // o estado certo para quem nao pediu desligamento remoto.
                string arquivoToken = Path.Combine(Programa.PastaDados, "shutdown.token");
                if (!File.Exists(arquivoToken)) return;
                string token = File.ReadAllText(arquivoToken).Trim();
                if (token.Length < 8) return;

                string porta = EnvironmentVariable("PORT");
                if (porta.Length == 0) porta = "3000";

                System.Net.WebRequest wr = System.Net.WebRequest.Create("http://127.0.0.1:" + porta + "/api/servico/desligar");
                wr.Method = "POST";
                wr.Headers.Add("x-shutdown-token", token);
                wr.Timeout = 3000;
                using (System.Net.WebResponse w = wr.GetResponse()) { }

                // Da um pouco de tempo para o backup final terminar antes de
                // mexer nos arquivos -- e' ele que garante a copia consistente.
                Thread.Sleep(2500);
            }
            catch { }
        }
    }

    // ============================================================= aplicacao

    internal static class Aplicacao
    {
        private static Process _servidor;
        private static string _token;
        private static string _porta = "3000";

        public static void Inicia()
        {
            Inicia(true);
        }

        /// <summary>
        /// Sobe o servidor e abre o painel.
        ///
        /// `mostrarErro = false` e' o caminho do instalador: quando o Inno chama
        /// este .exe, ele esta em modo de linha de comando e uma `MessageBox`
        /// ficaria aberta esperando ninguem. Quem chamou em modo silencioso le o
        /// log.
        /// </summary>
        public static void Inicia(bool mostrarErro)
        {
            string destino = Programa.PastaPrograma;
            string node = Path.Combine(destino, "runtime", "node.exe");
            string servidor = Path.Combine(destino, "dist", "server.js");

            if (!File.Exists(node) || !File.Exists(servidor))
            {
                if (mostrarErro)
                    MessageBox.Show(
                        "O DeliveryAdmin nao esta instalado corretamente.\n\nProcure:\n" + destino,
                        "DeliveryAdmin", MessageBoxButtons.OK, MessageBoxIcon.Error);
                else
                    Instalador.EscreveNoLog(Instalador.LogDeInstalacao(), "ERRO: programa incompleto em " + destino);
                return;
            }

            // Ja esta rodando? O painel e' um, e dois processos brigariam pelo
            // banco -- que no SQLite e' "database is locked" na cara do dono.
            if (EstaNoAr())
            {
                AbreNavegador();
                return;
            }

            _token = GeraToken();
            File.WriteAllText(Path.Combine(Programa.PastaDados, "shutdown.token"), _token);

            ProcessStartInfo psi = new ProcessStartInfo(node, "\"" + servidor + "\"");
            psi.WorkingDirectory = destino;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;

            // O token vai pelo ambiente, e nao pelo .env: assim o valor muda a
            // cada boot e nunca fica gravado em arquivo que alguem possa ler.
            psi.EnvironmentVariables["DELIVERYADMIN_DATA"] = Programa.PastaDados;
            psi.EnvironmentVariables["DELIVERYADMIN_SHUTDOWN_TOKEN"] = _token;
            psi.EnvironmentVariables["BAILEYS_AUTH_DIR"] = Path.Combine(Programa.PastaDados, "auth_info_baileys");
            psi.EnvironmentVariables["PORT"] = _porta;

            _servidor = Process.Start(psi);

            bool subiu = false;
            for (int i = 0; i < 60 && !subiu; i++)
            {
                Thread.Sleep(500);
                if (_servidor.HasExited) break;
                try
                {
                    using (System.Net.WebResponse w = System.Net.WebRequest.Create("http://127.0.0.1:" + _porta + "/entrar").GetResponse())
                    {
                        subiu = true;
                    }
                }
                catch { }
            }

            if (subiu)
            {
                AbreNavegador();
                return;
            }

            MessageBox.Show(
                "O sistema nao subiu.\n\nO log esta em:\n" + Path.Combine(Programa.PastaDados, "logs"),
                "DeliveryAdmin", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }

        private static string GeraToken()
        {
            byte[] b = new byte[24];
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            return BitConverter.ToString(b).Replace("-", "");
        }

        private static bool EstaNoAr()
        {
            try
            {
                using (System.Net.WebResponse w = System.Net.WebRequest.Create("http://127.0.0.1:" + _porta + "/entrar").GetResponse())
                {
                    return true;
                }
            }
            catch { return false; }
        }

        private static void AbreNavegador()
        {
            try
            {
                Process.Start(new ProcessStartInfo("http://127.0.0.1:" + _porta + "/entrar") { UseShellExecute = true });
            }
            catch { }
        }
    }
}
