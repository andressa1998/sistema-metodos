// src/modules/esocial-generator.js

function gerarEventoS2200(dados) {
    const { cnpj, funcionario, data_admissao, matricula, salario_base, cargo, codigo_cbo, ambiente } = dados;

    return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtAdmissao/v_S_01_02_00">
    <evtAdmissao>
        <ideEvento>
            <tpAmb>${ambiente === 'producao' ? '1' : '2'}</tpAmb>
            <procEmi>1</procEmi>
            <verProc>1.0.0</verProc>
        </ideEvento>
        <ideEmpregador>
            <tpInsc>1</tpInsc>
            <nrInsc>${cnpj.replace(/\D/g, '')}</nrInsc>
        </ideEmpregador>
        <trabalhador>
            <cpfTrab>${funcionario.cpf.replace(/\D/g, '')}</cpfTrab>
            <nmTrab>${funcionario.nome}</nmTrab>
            <dtNasc>${funcionario.data_nascimento}</dtNasc>
            <sexo>${funcionario.sexo || 'M'}</sexo>
        </trabalhador>
        <vinculo>
            <matricula>${matricula}</matricula>
            <tpRegTrab>1</tpRegTrab>
            <infoRegimeTrab>
                <dtAdm>${data_admissao}</dtAdm>
                <cargo>
                    <nmCargo>${cargo}</nmCargo>
                    <codCBO>${codigo_cbo || '0000-00'}</codCBO>
                </cargo>
                <remun>
                    <vrSalFx>${salario_base}</vrSalFx>
                    <undSalFixo>1</undSalFixo>
                </remun>
            </infoRegimeTrab>
        </vinculo>
    </evtAdmissao>
</eSocial>`;
}

function gerarEventoS2240(dados) {
    const { cnpj, funcionario, data_inicio, codigo_atividade, descricao_atividade, fator_risco, ambiente } = dados;

    return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtRisco/v_S_01_02_00">
    <evtRisco>
        <ideEvento>
            <tpAmb>${ambiente === 'producao' ? '1' : '2'}</tpAmb>
            <procEmi>1</procEmi>
            <verProc>1.0.0</verProc>
        </ideEvento>
        <ideEmpregador>
            <tpInsc>1</tpInsc>
            <nrInsc>${cnpj.replace(/\D/g, '')}</nrInsc>
        </ideEmpregador>
        <infoAmb>
            <cpfTrab>${funcionario.cpf.replace(/\D/g, '')}</cpfTrab>
            <dtIniCondicao>${data_inicio}</dtIniCondicao>
            <infoAtiv>
                <codAtiv>${codigo_atividade}</codAtiv>
                <descAtiv>${descricao_atividade}</descAtiv>
                <fatorRisco>
                    <codFator>${fator_risco}</codFator>
                </fatorRisco>
            </infoAtiv>
        </infoAmb>
    </evtRisco>
</eSocial>`;
}

function gerarEventoS1200(dados) {
    const { cnpj, funcionario, matricula, periodo_apuracao, remuneracoes = [] } = dados;

    let remuneracoesXml = '';
    remuneracoes.forEach(rem => {
        remuneracoesXml += `
            <remun>
                <codRubr>${rem.codigo}</codRubr>
                <vlrRubr>${rem.valor}</vlrRubr>
            </remun>
        `;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtRemuneracao/v_S_01_02_00">
    <evtRemuneracao>
        <ideEvento>
            <tpAmb>2</tpAmb>
            <procEmi>1</procEmi>
            <verProc>1.0.0</verProc>
        </ideEvento>
        <ideEmpregador>
            <tpInsc>1</tpInsc>
            <nrInsc>${cnpj.replace(/\D/g, '')}</nrInsc>
        </ideEmpregador>
        <infoRemun>
            <matricula>${matricula}</matricula>
            <perApur>${periodo_apuracao}</perApur>
            <itensRemun>${remuneracoesXml}</itensRemun>
        </infoRemun>
    </evtRemuneracao>
</eSocial>`;
}

module.exports = {
    gerarEventoS2200,
    gerarEventoS2240,
    gerarEventoS1200
};