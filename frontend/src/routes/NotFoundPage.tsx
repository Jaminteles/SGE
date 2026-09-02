import { Link } from 'react-router-dom';
import { StateScreen } from '../ui/StateScreen';

export function NotFoundPage() {
  return (
    <StateScreen
      title="Página não encontrada"
      message="O endereço acessado não existe ou foi movido."
      action={<Link to="/">Voltar para o início</Link>}
    />
  );
}
