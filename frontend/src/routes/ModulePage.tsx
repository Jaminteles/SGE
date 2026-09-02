import { StateScreen } from '../ui/StateScreen';

/**
 * Espaço reservado de cada módulo. A fundação (Sprint 18) entrega navegação,
 * sessão, empresa ativa e componentes base; as telas de cada módulo entram nas
 * sprints seguintes.
 */
export function ModulePage({ title }: { title: string }) {
  return (
    <>
      <div className="page-header">
        <h1 className="page-header__title">{title}</h1>
      </div>
      <div className="card">
        <StateScreen
          title="Tela em construção"
          message="Você tem acesso a este módulo. As telas serão entregues nas próximas sprints da Fase 9."
        />
      </div>
    </>
  );
}
